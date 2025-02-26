require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios'); 
const https = require("https");
const User = require('../model/user');

const router = express.Router();
let tempUsers = {}; // Temporary store for unverified users

// Function to generate a random 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Nodemailer transporter 
const transporter = nodemailer.createTransport({
    host: 'smtp.us.appsuite.cloud',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Send OTP email
async function sendOTPEmail(email, otp) {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Bamilk Lens - Verify Your Email for Content Creation Conference',
        html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h1 style="color:rgb(13, 87, 216);"> Bamilk Lens Content Creation Conference</h1>
            <h2>Dear Participant,</h2>
            <h3>You're one step closer to joining the <strong>From Phone to Fame</strong> conference!</h3>
            <h3>Your One-Time Password (OTP) for email verification is:</h3>
            <h2 style="background-color:rgb(13, 87, 216) color: white; padding: 10px; display: inline-block; border-radius: 5px;">
                ${otp}
            </h2>
            <h3>Enter this OTP on the registration page to proceed with payment.</h3>
            <p>If you didn’t request this, please ignore this email.</p>
            <p>For more inquiries:</p>
            <p>📱 WhatsApp: <a href="https://wa.me/2348032597076" style="color:rgb(13, 87, 216); text-decoration: none;">+234 803 259 7076</a></p>
            <p>📞 Call: +234 706 595 0181</p>
            <p>See you at the conference! 🎉</p>
        </div>
        `
    };
    await transporter.sendMail(mailOptions);
}

const agent = new https.Agent({ rejectUnauthorized: false });

// **Function to Calculate Paystack Charges**
function calculatePaystackAmount(amount) {
    let paystackFee = amount * 0.015; // 1.5% Paystack fee
    if (amount > 2500) {
        paystackFee += 100; // Additional ₦100 fee for transactions above ₦2500
    }
    if (paystackFee > 2000) {
        paystackFee = 2000; // Paystack maximum fee
    }
    return Math.ceil(amount + paystackFee) * 100; // Convert to kobo
}

// **Route: Initiate Registration**
router.post('/register/initiate', async (req, res) => {
    const { name, email, tel } = req.body;

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered. Please log in.' });
        }

        const otp = generateOTP();
        tempUsers[email] = { name, email, tel, otp, emailVerified: false };

        await sendOTPEmail(email, otp);

        res.status(200).json({ message: 'OTP sent to email. Please verify.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error initiating registration.' });
    }
});

// **Route: Verify Email OTP**
router.post('/register/verify-email', (req, res) => {
    const { email, otp } = req.body;
    const user = tempUsers[email];

    if (!user || user.otp !== otp) {
        return res.status(400).json({ message: 'Invalid OTP. Try again.' });
    }

    user.emailVerified = true;
    res.status(200).json({ message: 'Email verified. Proceed to payment.' });
});

// **Route: Initiate Paystack Payment**
/*router.post('/register/pay', async (req, res) => {
    const { email } = req.body;
    const user = tempUsers[email];

    if (!user || !user.emailVerified) {
        return res.status(400).json({ message: 'Email not verified.' });
    }

    try {
        const amountInKobo = calculatePaystackAmount(50000); // Includes Paystack charges

        const paystackResponse = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email,
                amount: amountInKobo,
                callback_url: `${process.env.BASE_URL}/payment-success?email=${encodeURIComponent(email)}`

            },
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            }
        );

        res.json({ paymentLink: paystackResponse.data.data.authorization_url });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error initializing payment.' });
    }
});*/


router.post('/register/pay', async (req, res) => {
    const { email } = req.body;
    const user = tempUsers[email];

    if (!user || !user.emailVerified) {
        return res.status(400).json({ message: 'Email not verified.' });
    }

    try {
        const amountInKobo = calculatePaystackAmount(50000); // Includes Paystack charges

        const paystackResponse = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email,
                amount: amountInKobo,
                callback_url: `${process.env.BASE_URL}/register/payment-success?email=${encodeURIComponent(email)}`
            },
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            }
        );

        console.log('Paystack Response:', paystackResponse.data);

        if (!paystackResponse.data.status) {
            return res.status(500).json({ message: 'Paystack initialization failed.' });
        }

        res.json({ paymentLink: paystackResponse.data.data.authorization_url });
    } catch (error) {
        console.error('Error initializing payment:', error.response?.data || error.message);
        res.status(500).json({ message: 'Error initializing payment.' });
    }
});




router.get('/payment-success', async (req, res) => {
    const { email, reference } = req.query;

    if (!email || !reference) {
        return res.status(400).json({ message: 'Invalid request. Email or reference missing.' });
    }

    try {
        // **Verify Paystack Payment**
        const verificationResponse = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            }
        );

        // **Check if Payment is Successful**
        if (verificationResponse.data.data.status !== "success") {
            return res.status(400).json({ message: 'Payment not successful.' });
        }

        // **Check if User Already Exists**
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render('success', { name: existingUser.name });
        }

        

        // **Save User After Successful Payment**
        const newUser = new User({
            name: user.name,
            email: user.email,
            tel: user.tel,
            emailVerified: true
        });

        await newUser.save();
        delete tempUsers[email]; // Remove temporary session data

        // **Send Confirmation Email**
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: '🎉 Registration Successful - Bamilk Lens Content Creation Conference',
            html: `<p>Hi ${user.name}, your registration was successful!</p>`
        });

        // **Render the EJS Success Page**
        res.render('success', { name: user.name });
    } catch (error) {
        console.error('Error completing registration:', error.response?.data || error.message);
        res.status(500).json({ message: 'Error completing registration.' });
    }
});

/*
router.get('/payment-success', async (req, res) => {
    const { email, reference } = req.query;
    
    if (!email || !reference) {
        return res.status(400).json({ message: 'Invalid request parameters.' });
    }

    try {
        // Verify Paystack Payment
        const verificationResponse = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            }
        );

        if (verificationResponse.data.data.status !== "success") {
            return res.status(400).json({ message: 'Payment not successful.' });
        }

        // Retrieve user details (if using tempUsers)
        const user = tempUsers[email] || { name: "Guest", email };

        // Render EJS success page
        res.render('success', { user, reference });
    } catch (error) {
        console.error('Error verifying payment:', error.response?.data || error.message);
        res.status(500).json({ message: 'Error verifying payment.' });
    }
});

*/


module.exports = router;
