// Simple relevance scorer function
// In production, use @mastra/evals for more sophisticated scoring

export const relevanceScorer = {
  name: 'ResearchRelevanceScorer',
  description: 'Evaluates how relevant the research response is to the query',
  score: async (input: { query: string; response: string }) => {
    const { query, response } = input;
    
    // Simple heuristic: check if response contains key terms from query
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const responseLower = response.toLowerCase();
    
    const matchingWords = queryWords.filter(word => responseLower.includes(word));
    const wordMatchScore = queryWords.length > 0 ? matchingWords.length / queryWords.length : 0;
    
    // Check for URLs (indicates research was done)
    const hasUrls = /https?:\/\//.test(response);
    const urlBonus = hasUrls ? 0.2 : 0;
    
    // Check response length
    const responseLength = response.length;
    const lengthScore = responseLength > 100 && responseLength < 2000 ? 0.1 : responseLength > 50 ? 0.05 : 0;
    
    // Combine scores
    const finalScore = Math.min(1, wordMatchScore * 0.7 + urlBonus + lengthScore);
    
    return {
      score: finalScore,
      reason: `Relevance score: ${finalScore.toFixed(2)}. ${hasUrls ? 'Sources cited.' : 'No sources cited.'}`,
    };
  },
};
