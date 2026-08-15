// if (process.env.NODE_ENV !== "production") {
//     require('dotenv').config();
// }



require('dotenv').config();

const sanitizeV5 = require('./utils/mongoSanitizeV5.js');
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const ejsMate = require('ejs-mate');
const session = require('express-session');
const flash = require('./utils/flash')
const ExpressError = require('./utils/ExpressError');
const methodOverride = require('method-override');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');
const helmet = require('helmet');

// const Campground = require('./models/campground');
// const Review = require('./models/review');

const userRoutes = require('./routes/users');
const campgroundRoutes = require('./routes/campground');
const reviewRoutes = require('./routes/reviews');
const { MongoStore } = require('connect-mongo');
// const { Http2ServerRequest } = require('http2');
const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/yelp-camp';

// There is no .env file on Vercel, so these have to come from
// Project Settings -> Environment Variables. Without DB_URL the app silently
// falls back to a localhost database that can never be reached from a
// serverless function, which surfaces as a generic 500 on every request.
if (process.env.VERCEL) {
    const missing = ['DB_URL', 'SECRET'].filter((key) => !process.env[key]);
    if (missing.length) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

// maxPoolSize keeps a burst of concurrent lambdas from exhausting the Atlas
// connection limit; each container opens its own pool.
mongoose.connect(dbUrl, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, "connection error:"));
db.once('open', () => {
    console.log("Database connected");
});


const app = express();
app.set('query parser', 'extended');

// Vercel terminates TLS at its edge and forwards over HTTP, so Express needs to
// trust the proxy headers for req.protocol / req.ip and secure cookies to work.
app.set('trust proxy', 1);

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')))
app.use(sanitizeV5({ replaceWith: '_' }));

const secret = process.env.SECRET || 'thisshouldbeabettersecret!'; // ADD THIS LINE
// ↑↑↑ ADD THIS CODE ↑↑↑

const store = MongoStore.create({
    mongoUrl: dbUrl,
    touchAfter: 24 * 60 * 60,
    crypto: {
        secret // ← ← ← *** CHANGE THIS LINE TO LOOK EXACTLY LIKE THIS! ***
    }
});

store.on("error", function (e) {
    console.log("SESSION STORE ERROR", e)
})

const sessionConfig = {
    store,
    name: 'session',
    secret, // ← ← ← *** CHANGE THIS LINE TO LOOK EXACTLY LIKE THIS! ***
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        // secure: true,
        // `expires` used to be set here as an absolute timestamp computed at
        // module load. A warm serverless container is reused for hours, so it
        // would hand out cookies dated from the cold start. maxAge is relative
        // to each response, which is what we actually want.
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}

app.use(session(sessionConfig));
app.use(flash());
app.use(helmet({ contentSecurityPolicy: false })); // TEMPORARY DISABLE CSP FOR MAPTILER

const scriptSrcUrls = [
    "https://stackpath.bootstrapcdn.com/",
    "https://kit.fontawesome.com/",
    "https://cdnjs.cloudflare.com/",
    "https://cdn.jsdelivr.net",
    "https://cdn.maptiler.com/", // add this
];
const styleSrcUrls = [
    "https://kit-free.fontawesome.com/",
    "https://stackpath.bootstrapcdn.com/",
    "https://fonts.googleapis.com/",
    "https://use.fontawesome.com/",
    "https://cdn.jsdelivr.net",
    "https://cdn.maptiler.com/", // add this
];
const connectSrcUrls = [
    "https://api.maptiler.com/", // add this
];

const fontSrcUrls = [];

// Derive the Cloudinary host from the env var so it can never drift out of sync
// with the cloud the images are actually uploaded to.
const cloudinaryImgUrl = process.env.CLOUDINARY_CLOUD_NAME
    ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/`
    : "https://res.cloudinary.com/";

app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc: [],
        connectSrc: ["'self'", ...connectSrcUrls],
        scriptSrc: ["'unsafe-inline'", "'self'", ...scriptSrcUrls],
        styleSrc: ["'self'", "'unsafe-inline'", ...styleSrcUrls],
        workerSrc: ["'self'", "blob:"],
        objectSrc: [],
        imgSrc: [
            "'self'",
            "blob:",
            "data:",
            cloudinaryImgUrl,
            "https://images.unsplash.com/",
            "https://api.maptiler.com/",
            "https://placehold.co/", // fallback image when a campground has no photos
        ],
        fontSrc: ["'self'", ...fontSrcUrls],

    },
})
);



app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


const difflog = require('./utils/difflog'); // TEMP DIAGNOSTIC
app.use((req, res, next) => {
    difflog('REQ', req); // TEMP
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
})

// app.get('/fakeUser', async (req, res) => {
//     const user = new User({ email: 'fake@example.com', username: 'Sam Karimpour' });
//     await user.save();,

//     res.send(user);
// }); 

app.use('/', userRoutes);
app.use('/campgrounds', campgroundRoutes);
app.use('/campgrounds/:id/reviews', reviewRoutes);

app.get('/', (req, res) => {
    res.render('home')
})


app.all('/{*path}', (req, res, next) => {
    next(new ExpressError('Page Not Found', 404));
})

app.use((err, req, res, next) => {
    const { statusCode = 500, message = 'Something went wrong' } = err;
    difflog('ERROR', req, { statusCode, errMessage: err.message, stack: (err.stack || '').split('\n')[1] }); // TEMP
    if (!err.message) err.message = 'Oh No, Something Went Wrong!'
    res.status(statusCode).render('error', { err });
})

// Vercel require()s this file and calls the exported app as the function
// handler; it must not bind a port there. require.main is only this module when
// the file is run directly (`node app.js`), i.e. local development.
if (require.main === module) {
    const port = process.env.PORT || 3002;
    app.listen(port, () => {
        console.log(`Serving on port ${port}`)
    })
}

module.exports = app;
