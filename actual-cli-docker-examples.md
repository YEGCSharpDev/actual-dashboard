# Actual CLI Docker Examples

## List Accounts
```bash
docker run -it --rm \
  -e ACTUAL_SERVER_URL=$ACTUAL_SERVER_URL \
  -e ACTUAL_PASSWORD=$ACTUAL_PASSWORD \
  -e ACTUAL_SYNC_ID=$ACTUAL_SYNC_ID \
  -v $(pwd)/actual-data:/app/.actual-data \
  actual-cli accounts list
```

## Run a Custom Query (ActualQL)
Find the last 5 transactions:
```bash
docker run -it --rm \
  --env-file .env \
  -v $(pwd)/actual-data:/app/.actual-data \
  actual-cli query run --last 5
```

## Export Transactions to JSON
```bash
docker run -it --rm \
  --env-file .env \
  -v $(pwd)/actual-data:/app/.actual-data \
  actual-cli transactions list --format json > transactions.json
```

---

# Using `docker compose` (Recommended)

The `docker-compose.cli.yml` file simplifies command execution.

## List Accounts
```bash
docker compose -f docker-compose.cli.yml run --rm actual-cli accounts list
```

## Sync Budget
```bash
docker compose -f docker-compose.cli.yml run --rm actual-cli budgets sync
```

## List Category Groups
```bash
docker compose -f docker-compose.cli.yml run --rm actual-cli category-groups list
```

## Add a Transaction
Note: Amounts are in **integer cents**. $50.00 = `5000`.
```bash
docker compose -f docker-compose.cli.yml run --rm actual-cli transactions add \
  --account "Checking" \
  --date "2024-05-16" \
  --amount -5000 \
  --payee "Grocery Store" \
  --notes "Weekly groceries"
```

---

# Helpful Tips

## Interactive Shell
If you want to poke around inside the container or run multiple commands in a row:
```bash
docker compose -f docker-compose.cli.yml run --rm --entrypoint /bin/bash actual-cli
```

## Volume Persistence
Always mount a volume to `/app/.actual-data`. This allows the CLI to cache your budget locally, making subsequent commands much faster because it doesn't have to download the entire budget every time.

## Formatting Output
The CLI supports different formats via the `--format` flag:
- `table` (Default)
- `json`
- `csv`

Example:
```bash
docker compose -f docker-compose.cli.yml run --rm actual-cli accounts list --format csv
```
