/**
 * Selection-length DFTs without changing the signal by padding it. Working convolution buffers may
 * be larger; the returned spectrum still has exactly N bins.
 * @module fourier
 */
// In-place radix-2 FFT. The inverse includes its 1/N normalization.
/**
 * Mutate reusable complex buffers instead of allocating values per butterfly; inverse normalization
 * belongs here so convolution callers do not double-scale.
 */
function fft(real, imaginary, inverse = false) {
	const length = real.length;
	for (let i = 1, j = 0; i < length; i++) {
		let bit = length / 2;
		for (; j & bit; bit /= 2) j ^= bit;
		j ^= bit;
		if (i < j) {
			[real[i], real[j]] = [real[j], real[i]];
			[imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
		}
	}
	for (let size = 2; size <= length; size *= 2) {
		const angle = (inverse ? 2 : -2) * Math.PI / size;
		const stepReal = Math.cos(angle), stepImaginary = Math.sin(angle);
		for (let start = 0; start < length; start += size) {
			let rotationReal = 1, rotationImaginary = 0;
			for (let i = start; i < start + size / 2; i++) {
				const j = i + size / 2;
				const re = real[j] * rotationReal - imaginary[j] * rotationImaginary;
				const im = real[j] * rotationImaginary + imaginary[j] * rotationReal;
				real[j] = real[i] - re;
				imaginary[j] = imaginary[i] - im;
				real[i] += re;
				imaginary[i] += im;
				const next = rotationReal * stepReal - rotationImaginary * stepImaginary;
				rotationImaginary = rotationReal * stepImaginary + rotationImaginary * stepReal;
				rotationReal = next;
			}
		}
	}
	if (inverse) for (let i = 0; i < length; i++) { real[i] /= length; imaginary[i] /= length; }
}

/**
 * Distinguish radix-2 input from Bluestein working size; padding the input itself would move the
 * frequencies being inspected.
 */
function transformSize(length) {
	const radix2 = length > 0 && Number.isInteger(Math.log2(length));
	return { size: radix2 ? length : 2 ** Math.ceil(Math.log2(Math.max(1, length * 2 - 1))), radix2 };
}

/**
 * Account for Bluestein's extra transforms in offloading decisions; nearly equal selection lengths
 * can have very different costs.
 */
export function fourierCost(length) {
	const { size, radix2 } = transformSize(length);
	return size * Math.log2(size) * (radix2 ? 8 : 24) + length * (radix2 ? 2 : 24);
}

// Forward DFT with a negative exponent. Bluestein handles arbitrary selection
// lengths without padding the signal or moving its frequency bins.
/**
 * Preserve exact selection length and negative-exponent phase convention, including prime lengths.
 * Returned views can retain larger convolution buffers.
 * @returns {{real: Float64Array, imaginary: Float64Array}} N complex coefficients, including both
 *   frequency halves.
 */
export function fourierSpectrum(samples) {
	const length = samples.length;
	if (!length) return { real: new Float64Array(), imaginary: new Float64Array() };
	const { size, radix2 } = transformSize(length);
	const real = new Float64Array(size), imaginary = new Float64Array(size);
	if (radix2) {
		real.set(samples);
		fft(real, imaginary);
	} else {
		const kernelReal = new Float64Array(size), kernelImaginary = new Float64Array(size);
		for (let i = 0; i < length; i++) {
			const angle = Math.PI * (i * i % (2 * length)) / length;
			const cosine = Math.cos(angle), sine = Math.sin(angle);
			real[i] = samples[i] * cosine;
			imaginary[i] = -samples[i] * sine;
			kernelReal[i] = cosine;
			kernelImaginary[i] = sine;
			if (i) { kernelReal[size - i] = cosine; kernelImaginary[size - i] = sine; }
		}
		fft(real, imaginary);
		fft(kernelReal, kernelImaginary);
		for (let i = 0; i < size; i++) {
			const re = real[i] * kernelReal[i] - imaginary[i] * kernelImaginary[i];
			imaginary[i] = real[i] * kernelImaginary[i] + imaginary[i] * kernelReal[i];
			real[i] = re;
		}
		fft(real, imaginary, true);
		for (let i = 0; i < length; i++) {
			const angle = Math.PI * (i * i % (2 * length)) / length;
			const cosine = Math.cos(angle), sine = Math.sin(angle);
			const re = real[i] * cosine + imaginary[i] * sine;
			imaginary[i] = imaginary[i] * cosine - real[i] * sine;
			real[i] = re;
		}
	}
	return { real: real.subarray(0, length), imaginary: imaginary.subarray(0, length) };
}
