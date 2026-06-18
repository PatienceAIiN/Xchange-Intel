async function run() {
  const q = 'AUMAI HEALTHCARE SOLUTION PRIVATE LIMITED CIN';
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  });
  const html = await res.text();
  console.log('Snippet matches:', [...html.matchAll(/<a class="result__snippet[^>]+>([\s\S]*?)<\/a>/gi)].length);
}
run();
