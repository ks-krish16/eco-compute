const express = require('express');
const path = require('path');
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.render('home');
});

app.get('/signup', (req, res) => {
    res.render('signup');
});

app.get('/recruit', (req, res) => {
    res.render('recruit');
});

app.get('/provider', (req, res) => {
    res.render('provider');
});

app.get('/subscription', (req, res) => {
    res.render('subscription');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));
