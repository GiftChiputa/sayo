using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Text;

// Windows-only, dependency-free bridge. The parent receives events over stdout;
// stdin accepts control verbs, never source code or arbitrary commands.
class InputBridge {
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    static HookProc callback = Hook;
    static IntPtr hook, target, targetFocus;
    static IntPtr overlayWindow;
    static long lastOverlayRaise;
    static bool altDown, usedWithOtherKey, armed, changed, waitingForPaste;
    static AltGesture gesture = new AltGesture();
    static string lease;
    static int lastMouse;
    static System.Windows.Forms.Timer watch;
    [StructLayout(LayoutKind.Sequential)] struct Key { public uint vk, scan, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct GUIINFO { public int size, flags; public IntPtr active, focus, capture, menu, move, caret; public int l,t,r,b; }
    [StructLayout(LayoutKind.Sequential)] struct KEYINPUT { public ushort vk, scan; public uint flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public KEYINPUT key; [FieldOffset(0)] public MOUSEINPUT mouse; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy; public uint mouseData,flags,time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION data; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x,y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left,top,right,bottom; }
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr window,int index,IntPtr value);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out RECT rect);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int maximum);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int code,IntPtr w,IntPtr l);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUIINFO info);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] input, int size);
    static readonly object outputLock = new object();
    static void Emit(string value) { lock(outputLock) { Console.WriteLine(value); Console.Out.Flush(); } }
    static IntPtr Focus(IntPtr window) { uint pid; var info = new GUIINFO(); info.size = Marshal.SizeOf(info); return GetGUIThreadInfo(GetWindowThreadProcessId(window,out pid), ref info) ? info.focus : IntPtr.Zero; }
    static IntPtr Hook(int code, IntPtr w, IntPtr l) {
        if(code >= 0) {
            var key = (Key)Marshal.PtrToStructure(l,typeof(Key));
            bool down = w.ToInt64() == 0x100 || w.ToInt64() == 0x104;
            bool up = w.ToInt64() == 0x101 || w.ToInt64() == 0x105;
            if((key.flags & 0x10) == 0) {
                if(key.vk == 0xA5 && (GetAsyncKeyState(0x11) & 0x8000) == 0) {
                    if(down && !altDown) { altDown = true; usedWithOtherKey = false; gesture.Down(Now()); }
                    if(up && altDown) {
                        altDown = false;
                        if(!usedWithOtherKey && (GetAsyncKeyState(0x11) & 0x8000) == 0) {
                            gesture.Up(Now());
                        } else gesture.Cancel();
                    }
                    // Right Alt is VOOL's dedicated key. Suppress bare Alt menu activation.
                    return new IntPtr(1);
                } else if(down) {
                    if(altDown) { usedWithOtherKey=true; gesture.Cancel(); }
                    // Edits while waiting invalidate automatic insertion into a stale caret.
                    if(armed && waitingForPaste && key.vk != 0x11 && key.vk != 0x12 && key.vk != 0x10) changed=true;
                }
            }
        }
        return CallNextHookEx(hook,code,w,l);
    }
    static long Now() { return Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency; }
    static bool OverRecordingBar() {
        POINT point; RECT rect;
        return overlayWindow!=IntPtr.Zero && IsWindowVisible(overlayWindow) && GetCursorPos(out point) && GetWindowRect(overlayWindow,out rect) &&
            point.x>=rect.left && point.x<rect.right && point.y>=rect.top && point.y<rect.bottom;
    }
    static void RaiseRecordingBar() {
        if(overlayWindow==IntPtr.Zero || !IsWindowVisible(overlayWindow)) return;
        // A no-activate topmost window still receives mouse clicks. WS_EX_TRANSPARENT
        // would pass them through to the user's text field and is deliberately cleared.
        long style=GetWindowLongPtr(overlayWindow,-20).ToInt64();
        long next=(style | 0x08000000L) & ~0x20L;
        if(style!=next) SetWindowLongPtr(overlayWindow,-20,new IntPtr(next));
        SetWindowPos(overlayWindow,new IntPtr(-1),0,0,0,0,0x0001|0x0002|0x0010);
    }
    static void InspectOverlay(IntPtr window) {
        bool above=false;
        for(IntPtr previous=GetWindow(GetForegroundWindow(),3);previous!=IntPtr.Zero;previous=GetWindow(previous,3)) {
            if(previous==window) { above=true; break; }
        }
        long style=GetWindowLongPtr(window,-20).ToInt64();
        Emit("{\"foreground\":\""+GetForegroundWindow().ToInt64()+"\",\"visible\":"+(IsWindowVisible(window)?"true":"false")+",\"topmost\":"+((style&8)!=0?"true":"false")+",\"noActivate\":"+((style&0x08000000L)!=0?"true":"false")+",\"clickThrough\":"+((style&0x20)!=0?"true":"false")+",\"aboveForeground\":"+(above?"true":"false")+"}");
    }
    static bool SafeTarget(string expected) {
        return armed && waitingForPaste && lease==expected && !changed && target!=IntPtr.Zero && GetForegroundWindow()==target && Focus(target)==targetFocus &&
            (GetAsyncKeyState(0x12)&0x8000)==0 && (GetAsyncKeyState(0x11)&0x8000)==0 && (GetAsyncKeyState(0x10)&0x8000)==0;
    }
    static INPUT KeyEvent(ushort vk, bool up) { var e = new INPUT(); e.type=1; e.data.key.vk=vk; e.data.key.flags=up ? 2u : 0u; return e; }
    static void TrackDestination() {
        IntPtr foreground=GetForegroundWindow();
        if(foreground!=IntPtr.Zero && foreground!=overlayWindow) { target=foreground; targetFocus=Focus(foreground); }
    }
    static void FreezeDestination() {
        if(!armed || waitingForPaste) return;
        TrackDestination(); changed=false; waitingForPaste=true;
        var text=new StringBuilder(512); GetWindowText(target,text,text.Capacity);
        string title=text.ToString().ToLowerInvariant().Replace(" - google chrome","").Replace(" - microsoft edge","");
        string kind="general";
        if(title.Contains("chatgpt") || title.Contains("codex") || title.Contains("claude") || title.Contains("gemini")) kind="prompt";
        else if(title.Contains("whatsapp") || title.Contains("telegram") || title.Contains("messenger") || title.Contains("discord") || title.Contains("outlook")) kind="message";
        else if(title=="google" || title.Contains("google search") || title.Contains("bing") || title.Contains("duckduckgo")) kind="search";
        // Only the broad category leaves this process, never the window title.
        Emit("{\"type\":\"destination\",\"id\":\""+lease+"\",\"kind\":\""+kind+"\"}");
    }
    [STAThread] static void Main(string[] args) {
        if(args.Length>0 && args[0]=="--test") { AltGesture.Test(); return; }
        if(args.Length==2 && args[0]=="--inspect-overlay") { InspectOverlay(new IntPtr(Int64.Parse(args[1]))); return; }
        gesture.Action = delegate(string action) {
            if(action.StartsWith("start")) { armed=false; waitingForPaste=false; lease=null; TrackDestination(); changed=false; }
            if(action=="stop") FreezeDestination();
            Emit("{\"type\":\""+action+"\"}");
        };
        hook=SetWindowsHookEx(13,callback,GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName),0);
        if(hook==IntPtr.Zero) { Emit("{\"type\":\"error\"}"); return; }
        var control=new Control(); control.CreateControl();
        watch=new System.Windows.Forms.Timer(); watch.Interval=20;
        watch.Tick += delegate {
            gesture.Tick(Now());
            if(Now()-lastOverlayRaise>=250) { RaiseRecordingBar(); lastOverlayRaise=Now(); }
            IntPtr foreground=GetForegroundWindow();
            // The bar is part of the dictation interaction, not a new paste target.
            if(armed && !waitingForPaste) TrackDestination();
            if(armed && waitingForPaste && foreground!=overlayWindow && (foreground!=target || Focus(target)!=targetFocus)) changed=true;
            int mouse=GetAsyncKeyState(1) & 0x8000;
            if(armed && waitingForPaste && mouse!=0 && lastMouse==0 && !OverRecordingBar()) changed=true;
            lastMouse=mouse;
        };
        // A held key may predate hook installation during Windows sign-in.
        if((GetAsyncKeyState(0xA5) & 0x8000)!=0 && (GetAsyncKeyState(0x11) & 0x8000)==0 && (GetAsyncKeyState(0x10) & 0x8000)==0) {
            altDown=true; gesture.Down(Now());
        }
        watch.Start();
        new Thread(delegate() {
            string line;
            while((line=Console.ReadLine())!=null) {
                string command=line;
                control.BeginInvoke((Action)delegate {
                    if(command.StartsWith("overlay ")) { long handle; if(Int64.TryParse(command.Substring(8),out handle)) { overlayWindow=new IntPtr(handle); RaiseRecordingBar(); } }
                    if(command=="finish-bar") { FreezeDestination(); if(armed && !changed && GetForegroundWindow()==overlayWindow && IsWindow(target)) SetForegroundWindow(target); }
                    if(command.StartsWith("arm ")) { lease=command.Substring(4); armed=true; waitingForPaste=false; changed=false; TrackDestination(); }
                    if(command.StartsWith("freeze ") && lease==command.Substring(7)) FreezeDestination();
                    if(command=="capture") { target=GetForegroundWindow(); targetFocus=Focus(target); changed=false; armed=false; lease=null; }
                    if(command=="disarm") { armed=false; waitingForPaste=false; lease=null; gesture.Reset(); }
                    if(command=="finished") { gesture.Reset(); }
                    if(command.StartsWith("can-paste ")) {
                        bool ready=SafeTarget(command.Substring(10));
                        Emit("{\"type\":\"paste\",\"ok\":"+(ready ? "true":"false")+"}");
                    }
                    if(command.StartsWith("paste ")) {
                        bool safe=SafeTarget(command.Substring(6));
                        armed=false;
                        lease=null;
                        var keys=new INPUT[] { KeyEvent(0x11,false),KeyEvent(0x56,false),KeyEvent(0x56,true),KeyEvent(0x11,true) };
                        uint sent=safe ? SendInput(4,keys,Marshal.SizeOf(typeof(INPUT))) : 0;
                        Emit("{\"type\":\"paste\",\"ok\":"+(sent==4 ? "true":"false")+"}");
                    }
                });
            }
            control.BeginInvoke((Action)delegate { Application.ExitThread(); });
        }) { IsBackground=true }.Start();
        Emit("{\"type\":\"ready\"}");
        Application.Run();
        UnhookWindowsHookEx(hook);
    }
}

// Hold => press-to-talk. Two short taps => latched recording. Next tap => stop.
// Trailing second taps after stopping are ignored to prevent accidental re-start.
class AltGesture {
    public Action<string> Action = delegate {};
    bool down, holding, latched;
    long pressed, lastTap=-1000, cooldown;
    public void Down(long now) { if(down || now < cooldown) return; down=true; pressed=now; }
    public void Tick(long now) {
        if(down && !holding && !latched && now-pressed>=180) { holding=true; lastTap=-1000; Action("start-hold"); }
    }
    public void Up(long now) {
        if(!down) return; down=false;
        if(holding) { holding=false; lastTap=-1000; cooldown=now+420; Action("stop"); }
        else if(latched) { latched=false; lastTap=-1000; cooldown=now+420; Action("stop"); }
        else if(now-lastTap<420) { latched=true; lastTap=-1000; Action("start-latch"); }
        else lastTap=now;
    }
    public void Cancel() { bool running=holding; down=false; holding=false; lastTap=-1000; if(running) Action("stop"); }
    public void Reset() { down=false; holding=false; latched=false; lastTap=-1000; }
    public static void Test() {
        var events=new System.Collections.Generic.List<string>(); var g=new AltGesture(); g.Action=events.Add;
        g.Down(1000); g.Tick(1181); g.Up(1500);
        g.Down(2000); g.Up(2060); g.Down(2180); g.Up(2240); g.Tick(2600); g.Down(3000); g.Up(3070);
        g.Down(3150); g.Up(3200); g.Tick(3400);
        g.Down(4000); g.Cancel(); g.Up(4100);
        string result=String.Join(",",events);
        if(result!="start-hold,stop,start-latch,stop") throw new Exception("Gesture test failed: "+result);
        Console.WriteLine("PASS: hold/release, double-tap latch, tap stop, trailing tap guard, modifier cancellation");
    }
}
