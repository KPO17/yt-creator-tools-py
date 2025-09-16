exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Diagnostics
    const diagnostics = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'unknown',
      hasYouTubeKey: !!(process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'YOUR_YOUTUBE_API_KEY'),
      youtubeKeyLength: process.env.YOUTUBE_API_KEY ? process.env.YOUTUBE_API_KEY.length : 0,
      availableEnvVars: Object.keys(process.env).filter(key => !key.includes('PASSWORD') && !key.includes('SECRET')),
      functionContext: {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        memoryLimitInMB: context.memoryLimitInMB,
        getRemainingTimeInMillis: context.getRemainingTimeInMillis()
      }
    };

    // Test simple de l'API YouTube si la clé est disponible
    let apiTest = null;
    if (diagnostics.hasYouTubeKey) {
      try {
        const testUrl = `https://www.googleapis.com/youtube/v3/videos?id=dQw4w9WgXcQ&part=snippet&key=${process.env.YOUTUBE_API_KEY}`;
        const testResponse = await fetch(testUrl);
        apiTest = {
          status: testResponse.status,
          ok: testResponse.ok,
          statusText: testResponse.statusText
        };
      } catch (error) {
        apiTest = {
          error: error.message
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        message: "Test OK - Fonction Netlify opérationnelle",
        diagnostics,
        apiTest
      }, null, 2)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Erreur dans la fonction de test",
        details: error.message,
        stack: error.stack
      })
    };
  }
};