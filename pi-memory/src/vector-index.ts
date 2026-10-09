/**
 * Semantic search that scales: every vector also as sign bits (384 dims → 12 words), Hamming distance over all of them
 * (XOR + popcount: ~1 ms per 100k), then the exact cosine only on the best few hundred. Measured against brute force in
 * test/vector-index.test.ts; the full float scan cost ~280 ms at 100k memories.
 */
export interface VectorHit {
	id: string;
	/** Position in the ids given to the constructor (the record position in RecallIndex). */
	position: number;
	score: number;
}

export class VectorIndex {
	readonly dim: number;
	readonly size: number;
	private readonly ids: string[];
	private readonly matrix: Float32Array;
	private readonly bits: Uint32Array;
	private readonly words: number;
	/** Positions (in `ids`) that have a vector, in matrix order. */
	private readonly rows: Int32Array;

	constructor(ids: string[], vectors: Map<string, Float32Array>) {
		this.ids = ids;
		let dim = 0;
		for (const id of ids) {
			const vector = vectors.get(id);
			if (vector) {
				dim = vector.length;
				break;
			}
		}
		this.dim = dim;
		const rows: number[] = [];
		if (dim > 0) ids.forEach((id, position) => vectors.get(id)?.length === dim && rows.push(position));
		this.rows = Int32Array.from(rows);
		this.size = rows.length;
		this.words = Math.ceil(dim / 32);
		this.matrix = new Float32Array(this.size * dim);
		this.bits = new Uint32Array(this.size * this.words);
		rows.forEach((position, row) => {
			const vector = vectors.get(ids[position])!;
			this.matrix.set(vector, row * dim);
			for (let i = 0; i < dim; i++) if (vector[i] > 0) this.bits[row * this.words + (i >>> 5)] |= 1 << (i & 31);
		});
	}

	/** The k nearest by cosine (vectors are normalised), after a Hamming prefilter of `candidates` rows. */
	search(query: Float32Array, k: number, candidates = Math.max(256, k * 4)): VectorHit[] {
		if (this.size === 0 || query.length !== this.dim) return [];
		const words = this.words;
		const queryBits = new Uint32Array(words);
		for (let i = 0; i < this.dim; i++) if (query[i] > 0) queryBits[i >>> 5] |= 1 << (i & 31);
		const size = this.size;
		const bits = this.bits;
		const distances = new Uint16Array(size);
		const histogram = new Uint32Array(this.dim + 1);
		// Hot loop: locals only, 32-bit popcount (Math.imul keeps the multiply in integers).
		for (let row = 0, base = 0; row < size; row++, base += words) {
			let distance = 0;
			for (let w = 0; w < words; w++) {
				let x = bits[base + w] ^ queryBits[w];
				x -= (x >>> 1) & 0x55555555;
				x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
				distance += Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
			}
			distances[row] = distance;
			histogram[distance]++;
		}
		// Largest distance that still keeps about `candidates` rows (counting selection, no sort of 100k items); at the
		// cut distance only as many rows as still fit (ties must not grow the exact rescoring).
		let cut = 0;
		let below = 0;
		for (; cut <= this.dim; cut++) {
			if (below + histogram[cut] >= candidates) break;
			below += histogram[cut];
		}
		let atCut = candidates - below;
		const hits: VectorHit[] = [];
		const matrix = this.matrix;
		const dim = this.dim;
		for (let row = 0; row < size; row++) {
			const distance = distances[row];
			if (distance > cut) continue;
			if (distance === cut && atCut-- <= 0) continue;
			let dot = 0;
			const base = row * dim;
			for (let i = 0; i < dim; i++) dot += matrix[base + i] * query[i];
			const position = this.rows[row];
			hits.push({ id: this.ids[position], position, score: dot });
		}
		return hits.sort((a, b) => b.score - a.score).slice(0, k);
	}
}
