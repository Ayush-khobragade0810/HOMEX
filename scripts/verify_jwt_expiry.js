import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from Backend directory
dotenv.config({ path: path.join(process.cwd(), '.env') });

const secret = process.env.JWT_SECRET || 'dev-secret';
const expires = process.env.JWT_EXPIRE || '24h';

console.log('--- JWT Verification Test ---');
console.log('JWT_SECRET:', secret);
console.log('JWT_EXPIRE:', expires);

const user = {
    _id: 'test_user_id',
    email: 'test@example.com',
    role: 'admin'
};

const token = jwt.sign(
    {
        id: user._id,
        email: user.email,
        role: user.role
    },
    secret,
    { expiresIn: expires }
);

const decoded = jwt.decode(token);
const exp = decoded.exp;
const iat = decoded.iat;
const durationSeconds = exp - iat;
const durationHours = durationSeconds / 3600;

console.log('Token generated successfully.');
console.log('Issued At (iat):', new Date(iat * 1000).toISOString());
console.log('Expires At (exp):', new Date(exp * 1000).toISOString());
console.log('Duration (Hours):', durationHours);

if (durationHours === 24) {
    console.log('✅ SUCCESS: Token expiration is exactly 24 hours.');
} else {
    console.log('❌ FAILURE: Token expiration is', durationHours, 'hours instead of 24.');
    process.exit(1);
}
