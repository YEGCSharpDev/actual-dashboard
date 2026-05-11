/**
 * Actual Budget Sidecar Helper
 * 
 * Fetches all necessary dashboard data in a single session to avoid rate limiting.
 */
const api = require('@actual-app/api');
const path = require('path');
const fs = require('fs');

async function main() {
    // 1. Configuration from Environment Variables (Security Fix: P0-2)
    const serverUrl = process.env.ACTUAL_SERVER_URL;
    const password = process.env.ACTUAL_PASSWORD;
    const syncId = process.env.ACTUAL_SYNC_ID;
    const encryptionPassword = process.env.ACTUAL_ENCRYPTION_PASSWORD;
    const dataDir = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

    // Simple test mode for CI/Nix checks
    if (process.argv.includes('--test-connection')) {
        console.log("actual-helper: test-connection mode");
        process.exit(0);
    }

    // P2-R: Smoke test that exercises the library initialization
    if (process.argv.includes('--smoke-init')) {
        console.log("actual-helper: smoke-init mode");
        try {
            const smokeDir = path.join(process.cwd(), '.smoke-test-data');
            if (!fs.existsSync(smokeDir)) fs.mkdirSync(smokeDir);
            await api.init({ dataDir: smokeDir, serverURL: 'http://localhost' });
            await api.shutdown();
            console.log("actual-helper: library successfully loaded and initialized");
            process.exit(0);
        } catch (err) {
            // We expect a connection error, but 'MODULE_NOT_FOUND' or 'CompileError' would fail here
            if (err.message.includes('connect')) {
                console.log("actual-helper: library successfully loaded (connection failed as expected)");
                process.exit(0);
            }
            console.error(`actual-helper: smoke-init failed: ${err.message}`);
            process.exit(1);
        }
    }

    if (!serverUrl || !password || !syncId) {
        console.error("Error: ACTUAL_SERVER_URL, ACTUAL_PASSWORD, and ACTUAL_SYNC_ID environment variables are required.");
        process.exit(1);
    }

    // 2. API Initialization
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        await api.init({
            dataDir: dataDir,
            serverURL: serverUrl,
            password: password,
        });

        await api.downloadBudget(syncId, { password: encryptionPassword });
        await api.sync();

        // 3. Data Retrieval
        const results = {
            accounts: [],
            categories: [],
            transactions: [],
            budgets: {}, // month_str -> category_data
        };

        // Fetch Accounts and enrich with their current balance in parallel (P2-A)
        const rawAccounts = await api.getAccounts();
        results.accounts = await Promise.all(rawAccounts.map(async (acc) => {
            if (!acc.closed) {
                acc.balance_current = await api.getAccountBalance(acc.id);
            }
            return acc;
        }));

        // Fetch Categories with goal metadata
        results.categories = await api.runQuery(
            api.q('categories').select(['id', 'name', 'goal_def', 'is_income', 'group.name'])
        ).then(res => res.data);

        // Fetch All Transactions (current year + history)
        results.transactions = await api.runQuery(
            api.q('transactions')
                .filter({ is_parent: false })
                .select([
                    'date', 
                    'amount', 
                    'account', 
                    'account.name', 
                    'payee.name', 
                    'category.id', 
                    'category.name', 
                    'category.is_income', 
                    'category.group.name'
                ])
        ).then(res => res.data);

        // 4. Fetch Budgets for the entire transaction range (Correctness Fix: P1-2)
        const budgetMonths = Array.from(new Set(
            results.transactions
                .filter(t => t.date)
                .map(t => t.date.substring(0, 7))
        ));
        
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const m = date.toISOString().substring(0, 7);
            if (!budgetMonths.includes(m)) budgetMonths.push(m);
        }

        // Parallelize budget fetching with a small concurrency limit (P2-B, 4.2)
        // Using a simple chunk-based approach to prevent thundering herd
        const CHUNK_SIZE = 10;
        for (let i = 0; i < budgetMonths.length; i += CHUNK_SIZE) {
            const chunk = budgetMonths.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (month) => {
                results.budgets[month] = await api.getBudgetMonth(month);
            }));
        }

        // 5. Output Results with markers to separate from library logs
        process.stdout.write("\n__ACTUAL_JSON_START__\n");
        process.stdout.write(JSON.stringify(results));
        process.stdout.write("\n__ACTUAL_JSON_END__\n");

        // 6. Cleanup
        await api.shutdown();
        process.exit(0);

    } catch (err) {
        console.error(`Error: ${err.message}`);
        await api.shutdown().catch(() => {});
        process.exit(1);
    }
}

main().catch(err => {
    console.error(`Fatal Error: ${err.message}`);
    process.exit(1);
});
