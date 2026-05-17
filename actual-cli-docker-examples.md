# Actual CLI Docker Examples

## Sample Command : List Accounts
```bash
docker run -it --rm \
  -e ACTUAL_SERVER_URL=$ACTUAL_SERVER_URL \
  -e ACTUAL_PASSWORD=$ACTUAL_PASSWORD \
  -e ACTUAL_SYNC_ID=$ACTUAL_SYNC_ID \
  -v $(pwd)/actual-data:/app/.actual-data \
  preface8675/actual-cli accounts list
```

similar to above usage all commands and subcomands from this link can be run : https://actualbudget.org/docs/api/cli/
