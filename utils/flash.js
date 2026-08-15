const { format } = require('util');

module.exports = () => {
    return (req, res, next) => {
        if (req.flash) return next();
        req.flash = function (type, msg, ...rest) {
            if (!req.session) throw new Error('req.flash() requires sessions');
            const msgs = req.session.flash = req.session.flash || {};
            if (type && msg !== undefined) {
                if (rest.length) msg = format(msg, ...rest);
                const arr = msgs[type] = msgs[type] || [];
                Array.isArray(msg) ? arr.push(...msg) : arr.push(msg);
                return arr.length;
            }
            if (type) {
                const arr = msgs[type];
                delete msgs[type];
                return arr || [];
            }
            req.session.flash = {};
            return msgs;
        }
        next();
    }
}
