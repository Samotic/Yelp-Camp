require('dotenv').config();

const mongoose = require('mongoose');
const cities = require('./cities');
const { places, descriptors } = require('./seedHelpers');
const Campground = require('../models/campground');
const User = require('../models/user');

// Must match the database app.js talks to, otherwise the seeded campgrounds land
// in a local database the deployed app never reads from.
const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/yelp-camp';
console.log(`Seeding ${dbUrl.startsWith('mongodb+srv') ? 'the remote Atlas database' : dbUrl}`);

mongoose.connect(dbUrl);

const db = mongoose.connection;
db.on('error', console.error.bind(console, "connection error:"));
db.once('open', () => {
    console.log("Database connected");
});

const sample = array => array[Math.floor(Math.random() * array.length)];

// Served straight out of /public/images, so every seeded campground gets the same
// four photos instead of the random Cloudinary uploads this used to pull from.
const seedImages = [
    { url: '/images/waterfall-canyon.jpg', filename: 'seed/waterfall-canyon' },
    { url: '/images/forest-lake.jpg', filename: 'seed/forest-lake' },
    { url: '/images/meadow-sunset.jpg', filename: 'seed/meadow-sunset' },
    { url: '/images/mountain-river.jpg', filename: 'seed/mountain-river' },
];

const seedDB = async () => {
    // Use a real registered account so .populate('author') doesn't resolve to null
    // and show.ejs has a username to print.
    const user = await User.findOne({ username: { $exists: true } });
    if (!user) {
        console.log('No registered users in the database. Register an account first, then re-run this seed.');
        return;
    }
    await Campground.deleteMany({});
    for (let i = 0; i < 50; i++) {
        const random1000 = Math.floor(Math.random() * 1000);
        const price = Math.floor(Math.random() * 20) + 10;
        const camp = new Campground({
            author: user._id,
            location: `${cities[random1000].city}, ${cities[random1000].state}`,
            title: `${sample(descriptors)} ${sample(places)}`,
            description: 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Quisquam, quod.',
            price,

            geometry: {
                type: "Point",
                coordinates: [
                    cities[random1000].longitude,
                    cities[random1000].latitude,
                ]
            },

            // copy so each campground gets its own image subdocuments
            images: seedImages.map(img => ({ ...img })),

        })
        await camp.save();
    }
    // Report from the database rather than the loop counter, so this reflects what
    // was actually persisted.
    const total = await Campground.countDocuments();
    console.log(`Done. ${total} campgrounds now in "${mongoose.connection.name}".`);
}

// Without a .catch, a failure mid-loop surfaces only as an unhandled rejection
// and the script still looks like it "connected fine".
seedDB()
    .catch(err => {
        console.error('SEED FAILED:', err.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.connection.close());
