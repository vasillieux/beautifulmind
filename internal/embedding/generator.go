package embedding

import (
	"crypto/sha1"
	"encoding/binary"
	"math"
	"math/rand"
	"strings"
)

const embeddingDim = 4 // small dimension for our example

// creates a deterministic, pseudo-random vector for a given string.
// this ensures the same concept always gets the same embedding.
func GenerateEmbedding(text string) []float32 {
	h := sha1.New()
	h.Write([]byte(text))
	hash := h.Sum(nil)

	// use the hash as a seed so it's deterministic
	var seed int64
	binary.Read(strings.NewReader(string(hash)), binary.LittleEndian, &seed)
	r := rand.New(rand.NewSource(seed))

	embedding := make([]float32, embeddingDim)
	var norm float64
	for i := 0; i < embeddingDim; i++ {
		val := r.Float32()*2 - 1 // random number between -1 and 1
		embedding[i] = val
		norm += float64(val * val)
	}

	// normalize the vector, crucial for cosine similarity
	if norm > 0 {
		norm = math.Sqrt(norm)
		for i := 0; i < embeddingDim; i++ {
			embedding[i] /= float32(norm)
		}
	}

	return embedding
}

// calculates the similarity between two vectors.
// assumes vectors are already normalized, so it's just a dot product.
func CosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0.0
	}

	var dotProduct float32
	for i := range a {
		dotProduct += a[i] * b[i]
	}
	return dotProduct
}