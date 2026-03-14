
try {
    await import('./controllers/adminBooking.controller.js');
    console.log('✅ Syntax check passed');
} catch (error) {
    console.error('❌ Syntax check failed:', error);
}
