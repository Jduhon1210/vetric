export async function onRequest(context) {
  const url = 'https://api.census.gov/data/2022/acs/acs5?get=B19013_001E&for=zip%20code%20tabulation%20area:*&in=state:48';
  try {
    const res = await fetch(url);
    const data = await res.text();
    return new Response(data, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch(err) {
    return new Response(JSON.stringify({error: err.message}), {
      status: 500,
      headers: {'Content-Type': 'application/json'}
    });
  }
}
