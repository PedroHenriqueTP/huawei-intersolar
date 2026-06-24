import argparse
from pythonosc import dispatcher
from pythonosc import osc_server

def default_handler(address, *args):
    print(f"OSC Message Received -> Address: {address} | Data: {list(args)}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Resolume OSC Listener Emulator")
    parser.add_argument("--ip", default="0.0.0.0", help="The IP interface to bind to")
    parser.add_argument("--port", type=int, default=7000, help="The UDP port to listen on")
    
    args = parser.parse_args()

    disp = dispatcher.Dispatcher()
    disp.set_default_handler(default_handler)

    server = osc_server.ThreadingOSCUDPServer((args.ip, args.port), disp)
    print(f"Resolume OSC Emulator listening on UDP address: {server.server_address}")
    print("Press Ctrl+C to stop.")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nOSC Emulator stopped.")
