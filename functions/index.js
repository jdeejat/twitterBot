/* twitter bot using Twitter API v2, Cloud Functions and GPT3 OpenAI API*/
// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
const functions = require('firebase-functions');
// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
admin.initializeApp();

const dbRef = admin.firestore().doc('tokens/demo');

// Import the Twitter API client package.
const TwitterApi = require('twitter-api-v2').default;
const twitterClient = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID,
  clientSecret: process.env.TWITTER_CLIENT_SECRET,
});

// Import the OpenAI API client package.
const { Configuration, OpenAIApi } = require('openai');
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const callBackUrl = 'http://127.0.0.1:5000/nkt-twitterbot/us-central1/callback';

// STEP 1 - Auth function to generate authintication link
exports.auth = functions.https.onRequest(async (request, response) => {
  const { url, codeVerifier, state } = twitterClient.generateOAuth2AuthLink(
    callBackUrl,
    {
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    }
  );

  response.redirect(url);

  // store  verifier and state in firestore
  return await dbRef.set({ codeVerifier, state });
});

// STEP 2 - Callback url to redirect to after successful login
exports.callback = functions.https.onRequest(async (request, response) => {
  // get verifier and state from query params
  const { state, code } = request.query;
  // get verifier and state from firestore
  const dbSnapshot = await dbRef.get();
  const { codeVerifier, state: stateInDb } = dbSnapshot.data();
  // check if state matches
  if (state !== stateInDb) {
    return response.status(400).send('Invalid state');
  }
  // if matches longin to twitter
  const {
    client: loggedClient,
    accessToken,
    refreshToken,
  } = await twitterClient.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: callBackUrl,
  });
  // store access and refresh token in firestore
  dbRef.set({ accessToken, refreshToken });
  // OK
  response.sendStatus(200);
});

// STEP 3 - Tweet endpoint
exports.tweet = functions.https.onRequest(async (request, response) => {
  // get access token from firestore
  const { refreshToken } = (await dbRef.get()).data();
  // refresh access token in case it is expired
  const {
    client: refreshedClient,
    accessToken,
    refreshToken: newRefreshToken,
  } = await twitterClient.refreshOAuth2Token(refreshToken);
  // store new access token in firestore
  await dbRef.set({ accessToken, refreshToken: newRefreshToken });

  // opne ai
  const nextTweet = await openai.createCompletion({
    model: 'text-davinci-002',
    prompt:
      'wisdom help to make better choices and understand world you live in',
    max_tokens: 6,
    temperature: 0,
  });

  // tweet
  const { data } = await refreshedClient.v2.tweet(
    nextTweet.data.choices[0].text
  );
  // OK
  response.send(data);
});
