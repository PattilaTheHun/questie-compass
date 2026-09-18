# Tests

Node-based checks for the engine and the RestedXP reader. They need real data that is not in the repo:

```
node tests/engine.test.js <questdb-json-with-completed-ids>
node tests/rxp.test.js <path-to-_classic_era_> <questdb-json-with-completed-ids>
```

`questdb-json-with-completed-ids` is the snapshot JSON plus a `completed` array of quest IDs (see `samples/` locally; never committed).
