package app.musike.android;

import android.content.Context;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A tiny HTTP server in the local network for Jam sessions (web/src/lib/jam.ts). Every request is handed to
 * the page as a "request" event; the page answers with respond(). Only the local network can reach it, and
 * the page checks the session PIN on every call.
 */
@CapacitorPlugin(name = "JamServer")
public class JamServerPlugin extends Plugin {

    private ServerSocket server;
    private ExecutorService pool;
    private WifiManager.WifiLock wifiLock;
    private final AtomicLong ids = new AtomicLong();
    private final Map<String, LinkedBlockingQueue<JSObject>> waiting = new ConcurrentHashMap<>();

    @PluginMethod
    public void start(PluginCall call) {
        stopServer();
        int first = call.getInt("port", 4190);
        for (int port = first; port < first + 10; port++) {
            try {
                server = new ServerSocket(port);
                break;
            } catch (IOException e) {
                server = null;
            }
        }
        if (server == null) {
            call.reject("No free port");
            return;
        }
        pool = Executors.newFixedThreadPool(8);
        final ServerSocket s = server;
        final ExecutorService p = pool;
        new Thread(() -> {
            while (!s.isClosed()) {
                try {
                    Socket client = s.accept();
                    p.execute(() -> handle(client));
                } catch (IOException e) {
                    break;
                }
            }
        }, "jam-accept").start();
        try {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "youtify:jam");
            wifiLock.acquire();
        } catch (Exception ignored) {
            wifiLock = null;
        }
        JSObject result = new JSObject();
        result.put("port", server.getLocalPort());
        result.put("ips", localIps());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServer();
        call.resolve();
    }

    @PluginMethod
    public void respond(PluginCall call) {
        String rid = call.getString("rid", "");
        LinkedBlockingQueue<JSObject> q = waiting.get(rid);
        if (q != null) q.offer(call.getData());
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopServer();
    }

    private void stopServer() {
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {}
        server = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
    }

    private static JSArray localIps() {
        JSArray ips = new JSArray();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress a : Collections.list(nif.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) ips.put(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {}
        return ips;
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(c.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            int length = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0 && line.substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                    length = Math.min(Integer.parseInt(line.substring(colon + 1).trim()), 64 * 1024);
                }
            }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }

            String rid = Long.toString(ids.incrementAndGet());
            LinkedBlockingQueue<JSObject> q = new LinkedBlockingQueue<>();
            waiting.put(rid, q);
            JSObject event = new JSObject();
            event.put("rid", rid);
            event.put("method", parts[0]);
            event.put("url", parts[1]);
            event.put("body", new String(body, 0, read, StandardCharsets.UTF_8));
            event.put("remote", c.getInetAddress().getHostAddress());
            notifyListeners("request", event);

            JSObject answer = q.poll(15, TimeUnit.SECONDS);
            waiting.remove(rid);
            int status = answer != null ? answer.getInteger("status", 200) : 503;
            String type = answer != null ? answer.getString("type", "application/json") : "text/plain";
            String text = answer != null ? answer.getString("body", "") : "busy";
            byte[] out = text.getBytes(StandardCharsets.UTF_8);
            String head =
                "HTTP/1.1 " + status + " OK\r\n" +
                "Content-Type: " + type + "; charset=utf-8\r\n" +
                "Content-Length: " + out.length + "\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Headers: Content-Type\r\n" +
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                "Cache-Control: no-store\r\n" +
                "Connection: close\r\n\r\n";
            OutputStream os = c.getOutputStream();
            os.write(head.getBytes(StandardCharsets.US_ASCII));
            os.write(out);
            os.flush();
        } catch (Exception ignored) {}
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') buf.write(b);
            if (buf.size() > 8192) break;
        }
        if (b == -1 && buf.size() == 0) return null;
        return buf.toString("UTF-8");
    }
}
