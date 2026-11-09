// Counter of inferences running in worker threads, shared with them. onnxruntime aborts the whole process (SIGABRT,
// "HandleScope … without proper locking") when its worker thread is torn down while a run is in flight, so Pi waits
// for the counter to reach 0 before terminating a worker and before the process exits.
// One counter per worker, dropped when the worker exits (a terminated worker never decrements its own).
const counters = new Set<Int32Array>();

/** Main side: a fresh counter for a new worker (`buffer` goes in workerData); `attach` drops it when the worker exits. */
export function newCounter(): { buffer: SharedArrayBuffer; attach(worker: { on(event: "exit", listener: () => void): unknown }): void } {
	const counter = new Int32Array(new SharedArrayBuffer(4));
	counters.add(counter);
	return { buffer: counter.buffer as SharedArrayBuffer, attach: (worker) => void worker.on("exit", () => counters.delete(counter)) };
}

/** Worker side: marks one inference as running until the returned function is called. */
export function markBusy(buffer: SharedArrayBuffer): () => void {
	const c = new Int32Array(buffer);
	Atomics.add(c, 0, 1);
	return () => {
		Atomics.sub(c, 0, 1);
		Atomics.notify(c, 0);
	};
}

const total = () => { let n = 0; for (const c of counters) n += Atomics.load(c, 0); return n; };
export const isBusy = () => total() > 0;

/** Blocks the calling thread until no inference runs, at most `ms`. Only for process exit, where nothing else can wait. */
export function waitIdle(ms: number): void {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const busy = [...counters].find((c) => Atomics.load(c, 0) > 0);
		if (!busy) return;
		Atomics.wait(busy, 0, Atomics.load(busy, 0), 50);
	}
}

let hooked = false;
/** Once per process: the exit waits (up to 10 s) for running inferences. */
export function guardExit(): void {
	if (hooked) return;
	hooked = true;
	process.on("exit", () => waitIdle(10_000));
}
