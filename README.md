# test-http-proxy


## Usage 
### 20% of requests fail with 500, everything forwarded to httpbin
node proxy.js

### Custom target + 30% failure rate
TARGET=https://api.example.com FAIL_RATE=0.3 node proxy.js

### Never fail (pure pass-through), useful as a baseline
TARGET=http://localhost:8080 FAIL_RATE=0 node proxy.js

