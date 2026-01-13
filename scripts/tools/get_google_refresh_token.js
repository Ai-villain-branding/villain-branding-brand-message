/**
 * Helper script to get Google Drive OAuth2 refresh token
 * 
 * Run this script once to get your refresh token:
 * node get_google_refresh_token.js
 * 
 * Then add the refresh token to your .env file as GOOGLE_DRIVE_REFRESH_TOKEN
 */

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

// Get credentials from environment
const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
    console.error('❌ Error: GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET must be set in environment variables');
    console.error('\nPlease set them in your .env file or export them:');
    console.error('export GOOGLE_DRIVE_CLIENT_ID="your-client-id"');
    console.error('export GOOGLE_DRIVE_CLIENT_SECRET="your-client-secret"');
    process.exit(1);
}

const redirectUri = 'http://localhost:3001/oauth2callback';
const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
);

const scopes = ['https://www.googleapis.com/auth/drive.file'];

// Generate authorization URL
const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force consent screen to get refresh token
});

console.log('\n🔐 Google Drive OAuth2 Setup');
console.log('================================\n');
console.log('⚠️  IMPORTANT: Make sure your Google OAuth app has this redirect URI configured:');
console.log('   ' + redirectUri + '\n');
console.log('   Go to: https://console.cloud.google.com/apis/credentials');
console.log('   Edit your OAuth 2.0 Client ID');
console.log('   Add "' + redirectUri + '" to Authorized redirect URIs\n');
console.log('1. Opening browser for authorization...\n');
console.log('2. After authorization, you will be redirected back automatically.\n');

// Start a local server to receive the OAuth callback
const server = http.createServer(async (req, res) => {
    try {
        const qs = url.parse(req.url, true).query;
        
        if (qs.error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                    <body>
                        <h1>Authorization Error</h1>
                        <p>${qs.error}</p>
                        <p>${qs.error_description || ''}</p>
                        <p>You can close this window.</p>
                    </body>
                </html>
            `);
            server.close();
            process.exit(1);
            return;
        }

        if (qs.code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <html>
                    <body>
                        <h1>Authorization Successful!</h1>
                        <p>You can close this window and return to the terminal.</p>
                    </body>
                </html>
            `);

            try {
                const { tokens } = await oauth2Client.getToken(qs.code);
                
                if (tokens.refresh_token) {
                    console.log('\n✅ Success! Your refresh token is:');
                    console.log('\n' + tokens.refresh_token + '\n');
                    console.log('Add this to your .env file:');
                    console.log('GOOGLE_DRIVE_REFRESH_TOKEN="' + tokens.refresh_token + '"\n');
                } else {
                    console.log('\n⚠️  Warning: No refresh token received.');
                    console.log('This might happen if you\'ve already authorized the app before.');
                    console.log('Try revoking access at: https://myaccount.google.com/permissions');
                    console.log('Then run this script again.\n');
                }
            } catch (error) {
                console.error('\n❌ Error getting token:', error.message);
            }
            
            server.close();
            process.exit(0);
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Waiting for authorization...</h1></body></html>');
        }
    } catch (error) {
        console.error('Error handling callback:', error);
        server.close();
        process.exit(1);
    }
}).listen(3001, () => {
    // Open browser automatically
    const { exec } = require('child_process');
    const platform = process.platform;
    let command;
    
    if (platform === 'darwin') {
        command = 'open';
    } else if (platform === 'win32') {
        command = 'start';
    } else {
        command = 'xdg-open';
    }
    
    exec(`${command} "${authUrl}"`, (error) => {
        if (error) {
            console.log('Could not open browser automatically. Please open this URL manually:');
            console.log('\n' + authUrl + '\n');
        }
    });
    
    console.log('Local callback server started on http://localhost:3001');
    console.log('Waiting for authorization...\n');
});

