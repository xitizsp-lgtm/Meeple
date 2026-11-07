# Meeple donation API on Render

The static website cannot keep email credentials secret or send an uploaded file by itself. This Node service validates the image and form fields, then sends the submission as an email attachment through Resend.

## Create the Render service

1. In Render, create a **Web Service** from this repository.
2. Set **Root Directory** to `donate-api`.
3. Use **Build Command** `npm install` and **Start Command** `npm start`.
4. Choose Node 20 or newer.
5. Add the environment variables below in the Render service settings.
6. Deploy the service and check that `https://YOUR-SERVICE.onrender.com/health` returns `{"status":"ok"}`.

## Configure email

Create a Resend account and verify a sender domain. In the Render service environment, set:

- `RESEND_API_KEY`: the API key from Resend. Keep it only in Render's environment settings.
- `MAIL_FROM`: a sender address on the domain verified with Resend, for example `Meeple <donations@your-verified-domain.com>`.
- `MAIL_TO`: `xitizsp@gmail.com,patwardhan.manasvi@gmail.com`
- `ALLOWED_ORIGIN`: the exact origin of the published website, for example `https://your-site.onrender.com` (no path or trailing slash).

## Connect the Donate page

After deploying the API, open `donate.html` and set the `donation-api-url` meta tag to the API URL:

```html
<meta name="donation-api-url" content="https://YOUR-SERVICE.onrender.com/api/donations">
```

Deploy the updated static site. The website origin in `ALLOWED_ORIGIN` must exactly match the published site origin. The form accepts JPEG, PNG, GIF, and WebP files up to 5 MB and limits each IP address to five submissions per 15 minutes.
