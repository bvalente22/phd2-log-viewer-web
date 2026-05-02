# Sample PHD2 Logs

Drop real PHD2 guide log files here (`*.log` or `*.txt`) to use during dev and to extend `parser/__tests__/golden.test.ts` with golden snapshots.

A small synthetic log used by the parser tests lives at `src/parser/__tests__/fixtures/synthetic.log` and does not need to be replicated here.

To verify parity with the C++ desktop app on a real log:
1. Run the desktop app, open the log, copy the stats numbers.
2. Add the log to this directory.
3. Add an entry to `golden.test.ts` with the expected stats values.
