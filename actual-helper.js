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

        // Fetch Accounts and enrich with their current balance
        const rawAccounts = await api.getAccounts();
        for (const acc of rawAccounts) {
            if (!acc.closed) {
                // Fetch balance explicitly as getAccounts() might return null for off-budget accounts
                acc.balance_current = await api.getAccountBalance(acc.id);
            }
            results.accounts.push(acc);
        }

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

        // 4. Fetch Budgets for the entire transaction range
        const budgetMonths = new Set();
        results.transactions.forEach(t => {
            if (t.date) budgetMonths.add(t.date.substring(0, 7));
        });
        
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
            budgetMonths.add(date.toISOString().substring(0, 7));
        }

        for (const month of budgetMonths) {
            results.budgets[month] = await api.getBudgetMonth(month);
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
