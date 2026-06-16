const SI_API = 'https://api.startupindia.gov.in/sih/api/noauth/search/profiles';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function runTest(dpiitRecogniseUser: boolean) {
  try {
    const res = await fetch(`${SI_API}?page=0&size=20`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://www.startupindia.gov.in',
        Referer: 'https://www.startupindia.gov.in/',
      },
      body: JSON.stringify({
        query: 'Enetro',
        focusSector: false,
        internationalUser: false,
        dpiitRecogniseUser,
        sort: { orders: [{ field: 'registeredOn', direction: 'DESC' }] },
        roles: ['Startup'],
      }),
    });
    const data = await res.json();
    console.log(`dpiitRecogniseUser: ${dpiitRecogniseUser}`);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}

async function run() {
  await runTest(true);
  await runTest(false);
}

run();
