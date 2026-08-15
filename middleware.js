const { campgroundSchema, reviewSchema } = require('./schemas.js');
const ExpressError = require('./utils/ExpressError');
const Campground = require('./models/campground');
const Review = require('./models/review');
const difflog = require('./utils/difflog'); // TEMP DIAGNOSTIC

module.exports.isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        // Only remember pages the user can actually be sent back to with a GET
        if (req.method === 'GET') {
            req.session.returnTo = req.originalUrl;
        }
        difflog('isLoggedIn:BLOCKED', req); // TEMP
        req.flash('error', 'You must be signed in first!');
        return res.redirect('/login');
    }
    next();
}

// When someone clicks Login/Register from an ordinary page, remember that page
// so we can send them back to it. isLoggedIn only records pages it *blocked*,
// which misses the common case of logging in voluntarily mid-browse.
// An existing returnTo (set by isLoggedIn) always wins.
module.exports.rememberReferrer = (req, res, next) => {
    if (!req.session.returnTo) {
        const referrer = req.get('Referrer');
        if (referrer) {
            try {
                const url = new URL(referrer);
                const sameSite = url.host === req.get('host');
                const isAuthPage = /^\/(login|register|logout)\/?$/.test(url.pathname);
                if (sameSite && !isAuthPage) {
                    req.session.returnTo = url.pathname + url.search;
                }
                difflog('rememberReferrer', req, { sameSite, isAuthPage }); // TEMP
            } catch (e) {
                // malformed Referrer header - just fall through to the default
            }
        } else {
            difflog('rememberReferrer:NO-REFERRER', req); // TEMP
        }
    } else {
        difflog('rememberReferrer:ALREADY-SET', req); // TEMP
    }
    next();
}

module.exports.validateCampground = (req, res, next) => {
    const { error } = campgroundSchema.validate(req.body);
    if (error) {
        const msg = error.details.map(el => el.message).join(',')
        throw new ExpressError(msg, 400);
    } else {
        next();
    }
}

module.exports.isAuthor = async (req, res, next) => {
    const { id } = req.params;
    const campground = await Campground.findById(id);
    // Runs before the route handler's own null check, so guard here too.
    if (!campground) {
        req.flash('error', 'Cannot find that campground!');
        return res.redirect('/campgrounds');
    }
    if (!campground.author.equals(req.user._id)) {
        req.flash('error', 'You do not have permission to edit this campground!');
        return res.redirect(`/campgrounds/${id}`);
    }
    next();
}

module.exports.isReviewAuthor = async (req, res, next) => {
    const { id, reviewId } = req.params;
    const review = await Review.findById(reviewId);
    if (!review.author.equals(req.user._id)) {
        req.flash('error', 'You do not have permission to edit this review!');
        return res.redirect(`/campgrounds/${id}`);
    }
    next();
}


// Passport regenerates the session inside req.login(), which wipes
// req.session.returnTo before the login/register handler ever runs.
// Copy it onto res.locals first so it survives authentication.
module.exports.storeReturnTo = (req, res, next) => {
    if (req.session.returnTo) {
        res.locals.returnTo = req.session.returnTo;
    }
    next();
}

module.exports.validateReview = (req, res, next) => {
    const { error } = reviewSchema.validate(req.body);
    if (error) {
        const msg = error.details.map(el => el.message).join(', ')
        throw new ExpressError(msg, 400);
    } else {
        next();
    }
}