exports.handler = async () => {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hasYouTubeKey: !!process.env.YOUTUBE_API_KEY,
      keyLength: process.env.YOUTUBE_API_KEY?.length || 0
    })
  };
};