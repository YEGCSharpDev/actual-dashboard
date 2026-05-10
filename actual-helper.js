/**
 * Actual Budget Sidecar Helper
 * 
 * Fetches all necessary dashboard data in a single session to avoid rate limiting.
 */
const api = require('@actual-app/api');
const path = require('path');
const fs = require('fs');

async function main() {
    // 1. Argument Parsing
    const args = process.argv.slice(2);
    const options = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
            options[key] = value;
        }
    }

    if (options.help) {
        console.log("Usage: node actual-helper.js --server-url <url> --password <pass> --sync-id <id> [--encryption-password <pass>] [--data-dir <path>]");
        process.exit(0);
    }

    if (options['test-connection']) {
        console.log("actual-helper: test-connection mode");
        process.exit(0);
    }

    // 2. Configuration
    const serverUrl = options['server-url'];
    const password = options.password;
    const syncId = options['sync-id'];
    const encryptionPassword = options['encryption-password'];
    const dataDir = options['data-dir'] || path.join(process.cwd(), '.actual-data');

    if (!serverUrl || !password || !syncId) {
        console.error("Error: --server-url, --password, and --sync-id are required.");
        process.exit(1);
    }

    // 3. API Initialization
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

        // 4. Data Retrieval
        const results = {
            accounts: [],
            categories: [],
            transactions: [],
            budgets: {}, // month_str -> category_data
        };

        // Fetch Accounts
        results.accounts = await api.getAccounts();

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

        // Fetch Budgets (3-month window)
        const now = new Date();
        for (let i = 0; i < 3; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const monthStr = date.toISOString().substring(0, 7); // YYYY-MM
            results.budgets[monthStr] = await api.getBudgetMonth(monthStr);
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
