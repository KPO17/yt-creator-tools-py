// netlify/functions/debug-subtitles.js
// Fonction de diagnostic pour identifier le problème

exports.handler = async (event, context) => {
  console.log('=== DIAGNOSTIC SUBTITLES ===');
  
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const diagnostic = {
    timestamp: new Date().toISOString(),
    environment: {},
    nodejs: {},
    python: {},
    dependencies: {},
    filesystem: {},
    errors: []
  };

  try {
    // 1. ENVIRONNEMENT
    diagnostic.environment = {
      NODE_ENV: process.env.NODE_ENV,
      PWD: process.env.PWD,
      PATH: process.env.PATH,
      PYTHONPATH: process.env.PYTHONPATH,
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME,
      AWS_EXECUTION_ENV: process.env.AWS_EXECUTION_ENV
    };

    // 2. NODE.JS
    diagnostic.nodejs = {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd()
    };

    // 3. FILESYSTEM
    const fs = require('fs');
    const path = require('path');
    
    diagnostic.filesystem = {
      currentDir: process.cwd(),
      files: []
    };

    try {
      const files = fs.readdirSync(process.cwd());
      diagnostic.filesystem.files = files;
      
      // Chercher le dossier netlify/functions
      if (files.includes('netlify')) {
        const netlifyPath = path.join(process.cwd(), 'netlify');
        const netlifyFiles = fs.readdirSync(netlifyPath);
        diagnostic.filesystem.netlifyDir = netlifyFiles;
        
        if (netlifyFiles.includes('functions')) {
          const functionsPath = path.join(netlifyPath, 'functions');
          const functionFiles = fs.readdirSync(functionsPath);
          diagnostic.filesystem.functionsDir = functionFiles;
          
          // Vérifier requirements.txt
          if (functionFiles.includes('requirements.txt')) {
            const reqPath = path.join(functionsPath, 'requirements.txt');
            const reqContent = fs.readFileSync(reqPath, 'utf8');
            diagnostic.dependencies.requirementsTxt = reqContent.split('\n');
          }
        }
      }
    } catch (fsError) {
      diagnostic.errors.push(`Filesystem error: ${fsError.message}`);
    }

    // 4. PYTHON - Test simple
    const { spawn } = require('child_process');
    
    diagnostic.python = await new Promise((resolve) => {
      const pythonTest = spawn('python3', ['--version'], { stdio: 'pipe' });
      let output = '';
      let error = '';
      
      pythonTest.stdout.on('data', (data) => output += data.toString());
      pythonTest.stderr.on('data', (data) => error += data.toString());
      
      pythonTest.on('close', (code) => {
        resolve({
          available: code === 0,
          version: output.trim() || error.trim(),
          exitCode: code
        });
      });
      
      pythonTest.on('error', (err) => {
        resolve({
          available: false,
          error: err.message,
          exitCode: -1
        });
      });
      
      setTimeout(() => {
        pythonTest.kill();
        resolve({ available: false, error: 'Timeout', exitCode: -2 });
      }, 5000);
    });

    // 5. MODULES PYTHON - Test détaillé
    if (diagnostic.python.available) {
      diagnostic.dependencies.pythonModules = await new Promise((resolve) => {
        const moduleTest = spawn('python3', ['-c', `
import sys
import pkg_resources
import subprocess

# Lister les modules installés
installed_packages = [d.project_name for d in pkg_resources.working_set]
print("INSTALLED:", installed_packages)

# Tester les modules spécifiques
modules_to_test = ['youtube_transcript_api', 'requests', 'urllib3']
results = {}

for module in modules_to_test:
    try:
        __import__(module)
        results[module] = "OK"
    except ImportError as e:
        results[module] = f"ERROR: {str(e)}"
    except Exception as e:
        results[module] = f"UNKNOWN: {str(e)}"

print("MODULES:", results)

# Tester youtube_transcript_api spécifiquement
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    print("YOUTUBE_API: OK")
    
    # Tester avec une vidéo de test
    try:
        transcript = YouTubeTranscriptApi.get_transcript('dQw4w9WgXcQ', languages=['en'])
        print("YOUTUBE_TEST: OK -", len(transcript), "segments")
    except Exception as e:
        print("YOUTUBE_TEST: ERROR -", str(e))
        
except ImportError as e:
    print("YOUTUBE_API: IMPORT_ERROR -", str(e))
except Exception as e:
    print("YOUTUBE_API: OTHER_ERROR -", str(e))
`], { stdio: 'pipe' });

        let output = '';
        let error = '';
        
        moduleTest.stdout.on('data', (data) => output += data.toString());
        moduleTest.stderr.on('data', (data) => error += data.toString());
        
        moduleTest.on('close', (code) => {
          const lines = output.split('\n');
          const result = {
            exitCode: code,
            rawOutput: output,
            errorOutput: error,
            installed: [],
            moduleStatus: {},
            youtubeApiStatus: 'UNKNOWN',
            youtubeTestResult: 'UNKNOWN'
          };
          
          lines.forEach(line => {
            if (line.startsWith('INSTALLED:')) {
              try {
                result.installed = JSON.parse(line.replace('INSTALLED: ', '').replace(/'/g, '"'));
              } catch (e) {
                result.installed = line.replace('INSTALLED: ', '');
              }
            } else if (line.startsWith('MODULES:')) {
              try {
                result.moduleStatus = JSON.parse(line.replace('MODULES: ', '').replace(/'/g, '"'));
              } catch (e) {
                result.moduleStatus = line.replace('MODULES: ', '');
              }
            } else if (line.startsWith('YOUTUBE_API:')) {
              result.youtubeApiStatus = line.replace('YOUTUBE_API: ', '');
            } else if (line.startsWith('YOUTUBE_TEST:')) {
              result.youtubeTestResult = line.replace('YOUTUBE_TEST: ', '');
            }
          });
          
          resolve(result);
        });
        
        moduleTest.on('error', (err) => {
          resolve({
            exitCode: -1,
            error: err.message,
            moduleStatus: {},
            youtubeApiStatus: 'SPAWN_ERROR'
          });
        });
        
        setTimeout(() => {
          moduleTest.kill();
          resolve({
            exitCode: -2,
            error: 'Timeout',
            moduleStatus: {},
            youtubeApiStatus: 'TIMEOUT'
          });
        }, 15000);
      });
    }

    // 6. TEST SIMPLE D'EXTRACTION
    if (diagnostic.python.available && 
        diagnostic.dependencies.pythonModules?.youtubeApiStatus === 'OK') {
      
      diagnostic.extractionTest = await new Promise((resolve) => {
        const extractTest = spawn('python3', ['-c', `
from youtube_transcript_api import YouTubeTranscriptApi
import json

try:
    transcript = YouTubeTranscriptApi.get_transcript('dQw4w9WgXcQ', languages=['en'])
    result = {
        'status': 'SUCCESS',
        'segments': len(transcript),
        'first_text': transcript[0]['text'] if transcript else None,
        'duration': sum(entry.get('duration', 0) for entry in transcript)
    }
    print(json.dumps(result))
except Exception as e:
    result = {
        'status': 'ERROR',
        'error': str(e),
        'error_type': type(e).__name__
    }
    print(json.dumps(result))
`], { stdio: 'pipe' });

        let output = '';
        extractTest.stdout.on('data', (data) => output += data.toString());
        extractTest.on('close', (code) => {
          try {
            resolve(JSON.parse(output.trim()));
          } catch (e) {
            resolve({ status: 'PARSE_ERROR', rawOutput: output });
          }
        });
        extractTest.on('error', (err) => {
          resolve({ status: 'SPAWN_ERROR', error: err.message });
        });
        
        setTimeout(() => {
          extractTest.kill();
          resolve({ status: 'TIMEOUT' });
        }, 10000);
      });
    }

  } catch (globalError) {
    diagnostic.errors.push(`Global error: ${globalError.message}`);
    console.error('Diagnostic error:', globalError);
  }

  // RECOMMANDATIONS
  diagnostic.recommendations = [];
  
  if (!diagnostic.python.available) {
    diagnostic.recommendations.push("❌ Python3 n'est pas disponible sur ce serveur Netlify");
  }
  
  if (diagnostic.python.available && 
      diagnostic.dependencies.pythonModules?.youtubeApiStatus?.includes('ERROR')) {
    diagnostic.recommendations.push("❌ Le module youtube-transcript-api n'est pas installé correctement");
  }
  
  if (!diagnostic.filesystem.functionsDir?.includes('requirements.txt')) {
    diagnostic.recommendations.push("❌ Le fichier requirements.txt est manquant dans netlify/functions/");
  }
  
  if (diagnostic.extractionTest?.status === 'SUCCESS') {
    diagnostic.recommendations.push("✅ L'extraction fonctionne ! Le problème est ailleurs");
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(diagnostic, null, 2)
  };
};