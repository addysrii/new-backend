2025-05-16T14:15:10.505Z] Response for POST /api/payments/upi/initiate: {
  "statusCode": 500
}
Booking Creation Debug: {
  totalAmount: 599,
  totalTicketCount: 1,
  requestPaymentMethod: 'upi',
  userId: new ObjectId('67e4e61385aeef69fc65e9c2'),
  eventId: '6823f8298a83eb9814a49fc0'
}
Booking Status Details: {
  isFreeBooking: false,
  finalPaymentMethod: 'upi',
  bookingStatus: 'initiate',
  paymentStatus: 'processing'
}
QR code automatically generated for ticket: GRP-6BEA8BD6
Generating QR code for group ticket at booking time
Successfully generated QR code at booking time
Saved Booking Details: {
  bookingId: new ObjectId('6827489d99ca0ada02d3a1f3'),
  status: 'initiate',
  paymentStatus: 'processing',
  paymentMethod: 'upi',
  hasQrCode: true
}
[2025-05-16T14:15:58.363Z] Request: POST /api/payments/upi/initiate: {
  "body": {
    "bookingId": "6827489d99ca0ada02d3a1f3",
    "amount": 619,
    "eventName": "MEETKATS MEETUP PARTY",
    "customerName": "Saroj Srivastava",
    "customerPhone": "09264940608",
    "customerEmail": "sarojsri478@gmail.com"
  },
  "headers": {
    "host": "new-backend-w86d.onrender.com",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0",
    "content-length": "193",
    "accept": "application/json",
    "accept-encoding": "gzip, br",
    "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
    "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY3ZTRlNjEzODVhZWVmNjlmYzY1ZTljMiIsImVtYWlsIjoic2Fyb2pzcmk0NzhAZ21haWwuY29tIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3NDc0MDMxNzksImV4cCI6MTc0NzQ4OTU3OX0.b7sLzjmGP7kPyP5b5WDpsZd-L3cQD4ONJ4D78bltrkQ",
    "cdn-loop": "cloudflare; loops=1",
    "cf-connecting-ip": "152.59.183.35",
    "cf-ipcountry": "IN",
    "cf-ray": "940b7d7d5c1747bf-SIN",
    "cf-visitor": "{\"scheme\":\"https\"}",
    "content-type": "application/json",
    "origin": "http://localhost:5173",
    "priority": "u=1, i",
    "referer": "http://localhost:5173/",
    "render-proxy-ttl": "4",
    "rndr-id": "d305b191-2956-4d8a",
    "sec-ch-ua": "\"Chromium\";v=\"136\", \"Microsoft Edge\";v=\"136\", \"Not.A/Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site",
    "true-client-ip": "152.59.183.35",
    "x-forwarded-for": "152.59.183.35, 172.71.152.91",
    "x-forwarded-proto": "https",
    "x-request-start": "1747404958359694"
  }
}
2025-05-16 14:15:58 [info]: Creating Cashfree UPI order for booking 6827489d99ca0ada02d3a1f3, amount: 619 {"service":"chat-api"}
2025-05-16 14:15:58 [error]: UPI payment initiation error: Converting circular structure to JSON
    --> starting at object with constructor 'ClientRequest'
    |     property 'res' -> object with constructor 'IncomingMessage'
    --- property 'req' closes the circle {"service":"chat-api","stack":"TypeError: Converting circular structure to JSON\n    --> starting at object with constructor 'ClientRequest'\n    |     property 'res' -> object with constructor 'IncomingMessage'\n    --- property 'req' closes the circle\n    at JSON.stringify (<anonymous>)\n    at Printf.template (/opt/render/project/src/utils/logger.js:32:22)\n    at Printf.transform (/opt/render/project/src/node_modules/logform/printf.js:11:26)\n    at Format.transform (/opt/render/project/src/node_modules/logform/combine.js:20:24)\n    at Console._write (/opt/render/project/src/node_modules/winston-transport/modern.js:91:33)\n    at doWrite (/opt/render/project/src/node_modules/readable-stream/lib/_stream_writable.js:390:139)\n    at writeOrBuffer (/opt/render/project/src/node_modules/readable-stream/lib/_stream_writable.js:381:5)\n    at Writable.write (/opt/render/project/src/node_modules/readable-stream/lib/_stream_writable.js:302:11)\n    at DerivedLogger.ondata (/opt/render/project/src/node_modules/readable-stream/lib/_stream_readable.js:629:20)\n    at DerivedLogger.emit (node:events:536:35)"}
[2025-05-16T14:15:58.785Z] Response for POST /api/payments/upi/initiate: {
  "statusCode": 500
}
ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy' setting is false (default). This could indicate a misconfiguration which would prevent express-rate-limit from accurately identifying users. See https://express-rate-limit.github.io/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/ for more information.
    at Object.xForwardedForHeader (/opt/render/project/src/node_modules/express-rate-limit/dist/index.cjs:187:13)
    at wrappedValidations.<computed> [as xForwardedForHeader] (/opt/render/project/src/node_modules/express-rate-limit/dist/index.cjs:398:22)
    at Object.keyGenerator (/opt/render/project/src/node_modules/express-rate-limit/dist/index.cjs:671:20)
    at /opt/render/project/src/node_modules/express-rate-limit/dist/index.cjs:724:32
    at async /opt/render/project/src/node_modules/express-rate-limit/dist/index.cjs:704:5 {
  code: 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR',
  help: 'https://express-rate-limit.github.io/ERR_ERL_UNEXPECTED_X_FORWARDED_FOR/'
}
Comparing password for user naman9936@gmail.com...
Candidate password length: 10
Stored hash: $2b$12$fRS...
Password comparison result for naman9936@gmail.com: true
Password not modified for user naman9936@gmail.com, skipping hashing
Socket auth middleware executing: {
  id: 'QeyJy9LKeX-xcLuxAAAB',
  hasAuth: true,
  hasHeaders: true,
  authToken: true,
  authHeader: true
}
Token found, verifying...
Token decoded successfully for user: 681b78106dbf32a0f998283d
User found: naman9936@gmail.com
User data attached to socket: { id: '681b78106dbf32a0f998283d', username: 'naman9936316' }
New socket connection: {
  id: 'QeyJy9LKeX-xcLuxAAAB',
  hasUser: true,
  userId: '681b78106dbf32a0f998283d',
  userObject: { id: '681b78106dbf32a0f998283d', username: 'naman9936316' }
}
2025-05-16 14:16:33 [info]: User connected: 681b78106dbf32a0f998283d, socket ID: QeyJy9LKeX-xcLuxAAAB {"service":"chat-api"}
User 681b78106dbf32a0f998283d registered with socket QeyJy9LKeX-xcLuxAAAB
Current online users: [ '681b78106dbf32a0f998283d' ]
