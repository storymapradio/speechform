// Speechform: a window with the image TouchDesigner grows from your speech above, and the
// transcript, the classifier and the memory below. On launch it starts the Speechform server
// (port 9990). TouchDesigner is opened from the app's own "Open TouchDesigner" button.
import Cocoa
import WebKit

// Where the Speechform folder is: remembered from last time, beside or above this app,
// or chosen once by the person using it.
func findRoot() -> String? {
    let fm = FileManager.default
    let ok = { (p: String) in fm.fileExists(atPath: p + "/Speechform.toe") && fm.fileExists(atPath: p + "/imagery/server.py") }
    if let saved = UserDefaults.standard.string(forKey: "root"), ok(saved) { return saved }
    var url = Bundle.main.bundleURL
    for _ in 0..<4 { url.deleteLastPathComponent(); if ok(url.path) { return url.path } }
    for guess in ["\(NSHomeDirectory())/Speechform", "\(NSHomeDirectory())/speechform"] where ok(guess) { return guess }
    let panel = NSOpenPanel()
    panel.message = "Choose the Speechform folder (the one that holds Speechform.toe)."
    panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.prompt = "Use this folder"
    guard panel.runModal() == .OK, let p = panel.url?.path, ok(p) else { return nil }
    UserDefaults.standard.set(p, forKey: "root")
    return p
}
var root = ""
let appURL = "http://127.0.0.1:9990/"

func up(_ url: String) -> Bool {
    var ok = false
    let sem = DispatchSemaphore(value: 0)
    var req = URLRequest(url: URL(string: url)!); req.timeoutInterval = 1.0
    URLSession.shared.dataTask(with: req) { _, r, _ in
        ok = (r as? HTTPURLResponse)?.statusCode == 200; sem.signal()
    }.resume()
    _ = sem.wait(timeout: .now() + 1.5)
    return ok
}

func sh(_ cmd: String) {
    let t = Process(); t.executableURL = URL(fileURLWithPath: "/bin/zsh"); t.arguments = ["-c", cmd]
    try? t.run(); t.waitUntilExit()
}

func startServer() {
    if up(appURL + "status") { return }
    let py = FileManager.default.isExecutableFile(atPath: root + "/.worker/bin/python") ? ".worker/bin/python" : "python3"
    sh("cd \"\(root)\" && mkdir -p runtime && nohup \(py) imagery/server.py >> runtime/server.log 2>&1 &")
    for _ in 0..<40 { if up(appURL + "status") { break }; Thread.sleep(forTimeInterval: 0.2) }
}

func menu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let m = NSMenu()
    m.addItem(withTitle: "Reload", action: #selector(Delegate.reload), keyEquivalent: "r")
    m.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    m.addItem(withTitle: "Quit Speechform", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = m
    let editItem = NSMenuItem(); main.addItem(editItem)
    let e = NSMenu(title: "Edit")
    e.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    e.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    e.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    e.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = e
    NSApp.mainMenu = main
}

class Delegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    @objc func reload() { web?.reload() }

    func applicationDidFinishLaunching(_ n: Notification) {
        let me = Bundle.main.bundleIdentifier ?? ""
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: me)
            .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
        if let o = others.first { o.activate(); exit(0) }
        menu()
        guard let r = findRoot() else { NSApp.terminate(nil); return }
        root = r
        startServer()
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1400, height: 900)
        let h = min(screen.height - 40, 1000.0), w = min(540.0, h * 0.56)
        window = NSWindow(contentRect: NSRect(x: screen.maxX - w - 30, y: screen.midY - h / 2, width: w, height: h),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Speechform"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.minSize = NSSize(width: 340, height: 600)
        web = WKWebView(frame: window.contentView!.bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")
        web.load(URLRequest(url: URL(string: appURL)!, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData))
        window.contentView!.addSubview(web)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows f: Bool) -> Bool { window?.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
