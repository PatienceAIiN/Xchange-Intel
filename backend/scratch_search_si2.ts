const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function testEndpoint(url: string, query: string, dpiitRecogniseUser: boolean) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://www.startupindia.gov.in',
        Referer: 'https://www.startupindia.gov.in/',
      },
      body: JSON.stringify({
        query,
        focusSector: false,
        industries: [], sectors: [], states: [], cities: [], stages: [], badges: [],
        roles: ['Startup'],
        page: 0,
        sort: { orders: [{ field: 'registeredOn', direction: 'DESC' }] },
        dpiitRecogniseUser,
        internationalUser: false,
      }),
    });
    const data = await res.json();
    console.log(`URL: ${url}`);
    console.log(`Query: "${query}", dpiitRecogniseUser: ${dpiitRecogniseUser}`);
    console.log(`Total elements: ${data.totalElements || data.totalElements === 0 ? data.totalElements : 'N/A'}`);
    const items = data.content || data.data || [];
    console.log(`Items count: ${items.length}`);
    for (const item of items.slice(0, 3)) {
      console.log(`- ${item.name || item.companyName}, DIPP: ${item.dippNumber || item.dippRecognitionStatus}, Certified: ${item.dippCertified}`);
    }
  } catch (e) {
    console.error(`Error for ${url}:`, e);
  }
}

async function run() {
  const endpoints = [
    'https://api.startupindia.gov.in/sih/api/noauth/search/profiles?page=0&size=20',
    'https://api.startupindia.gov.in/sih/api/noauth/search/profile?page=0&size=20'
  ];
  for (const url of endpoints) {
    await testEndpoint(url, 'Enetro', true);
    await testEndpoint(url, 'Enetro', false);
    await testEndpoint(url, 'A SEMICONSUMABLES', true);
  }
}

run();
