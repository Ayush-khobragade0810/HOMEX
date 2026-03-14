import { spawn } from 'child_process';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

console.log('🔍 DEBUGGING SERVER STARTUP...');

// Load env to check DB string
dotenv.config();

// Create a check for syntax errors first
import fs from 'fs';
const filesToCheck = [
    'server.js',
    'controllers/bookingController.js',
    'routes/booking.js',
    'routes/admin/bookings.js'
];

filesToCheck.forEach(file => {
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('<<<<<<<') || content.includes('=======')) {
            console.error(`❌ GIT CONFLICT MARKERS FOUND IN ${file}`);
        }
    } catch (e) {
        console.error(`⚠️ Could not read ${file}: ${e.message}`);
    }
});

// Try to start server
const server = spawn('node', ['server.js'], {
    stdio: 'pipe',
    shell: true
});

server.stdout.on('data', (data) => {
    console.log(`✅ STDOUT: ${data}`);
});

server.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`❌ STDERR: ${output}`);

    if (output.includes('bookingRoutes is not defined')) {
        console.error('\n🔥 FIX: Import bookingRoutes in server.js');
    }

    if (output.includes('does not provide an export named')) {
        console.error(`\n🔥 FIX: Missing export in controller.`);
    }
});

server.on('close', (code) => {
    console.log(`\nServer exited with code ${code}`);
    if (code !== 0 && code !== null) process.exit(code);
    // If it doesn't exit quickly, that's good!
});

// Kill after 10 seconds if still running (success)
setTimeout(() => {
    console.log('✅ Server ran for 10s. Likely SUCCESS.');
    server.kill();
    process.exit(0);
}, 10000);
