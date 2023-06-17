# kubernetes web tty demo with Deno

1. intended to be served from inside the cluster
1. serves a basic xterm.js which is plugged into a particular pod
1. uses websockets, which (with Deno) means that `--cert` must be provided as below
1. uses websocketstream, so you also need `--unstable`
1. is very insecure, do not serve on the internet
1. error handling is bad

you can run like this:

```
deno run -A --unstable --cert /var/run/secrets/kubernetes.io/serviceaccount/ca.crt mod.tsx
```
