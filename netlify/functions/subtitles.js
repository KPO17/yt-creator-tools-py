// netlify/functions/subtitles.js - VERSION TEST
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Méthode non autorisée' })
    };
  }

  try {
    console.log('Function called with:', event.body);
    
    const { videoId, format = 'srt' } = JSON.parse(event.body || '{}');
    
    if (!videoId) {
      throw new Error('videoId manquant');
    }

    // Contenu de test pour vérifier que la fonction fonctionne
    const testContent = `1
00:00:00,000 --> 00:00:03,000
Test subtitle for video ${videoId}

2
00:00:03,000 --> 00:00:06,000
Netlify function is working correctly!

3
00:00:06,000 --> 00:00:09,000
Format demandé: ${format}`;

    console.log('Returning test content for:', videoId);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/x-subrip; charset=utf-8',
        'Content-Disposition': `attachment; filename="${videoId}_test.srt"`
      },
      body: testContent
    };

  } catch (error) {
    console.error('Error in function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};