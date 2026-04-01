// ===========================================
// CLOUDFLARE WORKER - /functions/api/upload.js
// ===========================================
// With Google Drive PDF Backup (using YOUR working Apps Script)
// ===========================================

export async function onRequestPost(context) {
  try {
    const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
    const GITHUB_USER = context.env.GITHUB_USER || "iitjeelf";
    const GOOGLE_APPS_SCRIPT_URL = context.env.GOOGLE_APPS_SCRIPT_URL;
    
    if (!GITHUB_TOKEN) {
      return errorResponse("No GitHub token");
    }
    
    const formData = await context.request.formData();
    const className = formData.get('class').toLowerCase();
    const filename = formData.get('filename');
    const content = formData.get('content');
    const type = formData.get('type') || 'question';
    
    console.log(`=== UPLOAD START ===`);
    console.log(`Class: ${className}, Type: ${type}`);
    console.log(`Filename: ${filename}`);
    console.log(`Content length: ${content?.length || 0}`);
    
    // Ensure GitHub repo exists
    await ensureRepo(GITHUB_USER, className, GITHUB_TOKEN);
    
    let filePath;
    let message;
    
    if (type === 'answer') {
      // ANSWER: answer-key.txt in ROOT
      filePath = 'answer-key.txt';
      message = `Update answer key for ${className.toUpperCase()}`;
    } else {
      // QUESTION: in questions folder with original filename
      filePath = `questions/${filename}`;
      message = `Upload question: ${filename} to ${className.toUpperCase()}`;
    }
    
    console.log(`File path: ${filePath}`);
    
    // Upload to GitHub
    const result = await uploadFile(
      GITHUB_USER,
      className,
      filePath,
      content,
      GITHUB_TOKEN,
      message
    );
    
    console.log(`=== GITHUB UPLOAD SUCCESS ===`);
    console.log(`URL: ${result.url}`);
    
    // ===== GOOGLE DRIVE BACKUP (for answer keys only) =====
    // Using YOUR working Apps Script that expects plain text
    if (type === 'answer' && GOOGLE_APPS_SCRIPT_URL) {
      // Don't await - run in background so GitHub upload isn't delayed
      uploadToGoogleDrive(content, className, GOOGLE_APPS_SCRIPT_URL)
        .then(driveResult => {
          console.log('✓ Google Drive backup complete');
        })
        .catch(driveError => {
          console.error('✗ Google Drive backup failed:', driveError);
          // Note: GitHub upload already succeeded, so user doesn't see this error
        });
    }
    // ====================================================
    
    return successResponse(`Uploaded to ${className.toUpperCase()}`, result.url);
    
  } catch (error) {
    console.error('=== UPLOAD ERROR ===');
    console.error(error);
    return errorResponse(error.message);
  }
}

// ===== GOOGLE DRIVE UPLOAD FUNCTION - MATCHES YOUR WORKING APPS SCRIPT =====
async function uploadToGoogleDrive(content, className, appsScriptUrl) {
  try {
    console.log(`=== GOOGLE DRIVE BACKUP START ===`);
    
    // Format date: DD-MM-YYYY (your Apps Script expects this format)
    const today = new Date();
    const day = today.getDate().toString().padStart(2, '0');
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const year = today.getFullYear();
    const dateStr = `${day}-${month}-${year}`;
    
    console.log(`Date: ${dateStr}, Class: ${className}`);
    
    // DECODE the base64 content from frontend
    // Your Apps Script expects PLAIN TEXT, not base64
    const decodedContent = atob(content);
    console.log(`Content decoded, length: ${decodedContent.length} chars`);
    console.log(`First 100 chars: ${decodedContent.substring(0, 100)}`);
    
    // Send to your WORKING Apps Script
    console.log(`Sending to Apps Script: ${appsScriptUrl}`);
    
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        class: className,        // Your script expects 'class'
        date: dateStr,            // Your script expects 'date'
        content: decodedContent   // Your script expects plain text content
      })
    });
    
    console.log(`Response status: ${response.status}`);
    
    // Get response text
    const responseText = await response.text();
    console.log(`Raw response: ${responseText}`);
    
    // Try to parse as JSON
    let result;
    try {
      result = JSON.parse(responseText);
      console.log(`Parsed result:`, result);
    } catch (e) {
      console.error(`Response is not JSON:`, responseText);
      return null;
    }
    
    if (result.success) {
      console.log(`✓ Google Drive backup complete: ${result.message || 'Success'}`);
    } else {
      console.error(`✗ Google Drive error:`, result.error);
    }
    
    console.log(`=== GOOGLE DRIVE BACKUP END ===`);
    return result;
    
  } catch (error) {
    console.error(`✗ Google Drive exception:`, error);
    console.error(`Error name: ${error.name}`);
    console.error(`Error message: ${error.message}`);
    // Don't throw - we don't want to affect GitHub upload
    return null;
  }
}

// ===== GITHUB FUNCTIONS (KEEP AS IS - THEY WORK) =====

function githubHeaders(token, includeContentType = false) {
  const headers = {
    'Authorization': `token ${token}`,
    'User-Agent': 'LFJC-Portal',
    'Accept': 'application/vnd.github.v3+json'
  };
  
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  return headers;
}

function successResponse(message, url = null) {
  const response = { success: true, message };
  if (url) response.url = url;
  
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function errorResponse(message) {
  return new Response(JSON.stringify({
    success: false,
    message: message || 'Upload failed'
  }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function ensureRepo(username, repoName, token) {
  const repoUrl = `https://api.github.com/repos/${username}/${repoName}`;
  
  try {
    const checkResponse = await fetch(repoUrl, {
      headers: githubHeaders(token)
    });
    
    if (checkResponse.ok) {
      console.log(`✓ Repo ${repoName} exists`);
      return true;
    }
  } catch (error) {}
  
  // Create repo
  console.log(`Creating repo: ${repoName}`);
  const createResponse = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: githubHeaders(token, true),
    body: JSON.stringify({
      name: repoName,
      private: false,
      description: `LFJC Class ${repoName.toUpperCase()}`,
      auto_init: true
    })
  });
  
  if (!createResponse.ok) {
    const error = await createResponse.json();
    throw new Error(`Failed to create repo ${repoName}: ${error.message}`);
  }
  
  console.log(`✓ Repo ${repoName} created`);
  return true;
}

async function uploadFile(username, repoName, filePath, content, token, message) {
  const fileUrl = `https://api.github.com/repos/${username}/${repoName}/contents/${filePath}`;
  
  console.log(`=== FILE UPLOAD DEBUG ===`);
  console.log(`Target: ${fileUrl}`);
  
  // Get SHA if file exists (for updates)
  let sha = null;
  try {
    console.log(`Checking if file exists...`);
    const checkResponse = await fetch(fileUrl, {
      headers: githubHeaders(token)
    });
    
    console.log(`Check status: ${checkResponse.status}`);
    
    if (checkResponse.ok) {
      const fileData = await checkResponse.json();
      sha = fileData.sha;
      console.log(`✓ File EXISTS, SHA: ${sha?.substring(0, 8)}...`);
      console.log(`✓ Will UPDATE existing file`);
    } else if (checkResponse.status === 404) {
      console.log(`✗ File NOT FOUND (404)`);
      console.log(`✓ Will CREATE new file`);
    } else {
      console.log(`✗ Unexpected status: ${checkResponse.status}`);
    }
  } catch (error) {
    console.log(`✗ Error checking file: ${error.message}`);
  }
  
  // Prepare upload data
  console.log(`Preparing upload data...`);
  const uploadData = {
    message: message,
    content: content, // Content is already base64 from frontend
    branch: 'main'
  };
  
  // Add SHA if file exists (for update)
  if (sha) {
    uploadData.sha = sha;
    console.log(`Adding SHA for update: ${sha.substring(0, 8)}...`);
  } else {
    console.log(`No SHA - creating new file`);
  }
  
  console.log(`Uploading to GitHub...`);
  
  // Upload/Update file
  const uploadResponse = await fetch(fileUrl, {
    method: 'PUT',
    headers: githubHeaders(token, true),
    body: JSON.stringify(uploadData)
  });
  
  console.log(`Upload status: ${uploadResponse.status}`);
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    console.error(`Upload failed: ${errorText}`);
    throw new Error(`GitHub API error: ${uploadResponse.status}`);
  }
  
  const result = await uploadResponse.json();
  
  if (!result.content || !result.content.sha) {
    console.error(`Invalid response from GitHub:`, result);
    throw new Error('Invalid response from GitHub');
  }
  
  console.log(`✓ File ${sha ? 'UPDATED' : 'CREATED'}: ${filePath}`);
  console.log(`New SHA: ${result.content.sha.substring(0, 8)}...`);
  console.log(`URL: ${result.content.html_url}`);
  
  return {
    url: result.content.html_url,
    sha: result.content.sha
  };
}





















