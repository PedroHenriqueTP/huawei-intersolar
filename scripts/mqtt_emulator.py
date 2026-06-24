import time
import json
import random
import argparse
from paho.mqtt import client as mqtt_client

def connect_mqtt(host, port):
    client_id = f'esp32-emulator-{random.randint(0, 1000)}'
    client = mqtt_client.Client(mqtt_client.CallbackAPIVersion.VERSION2, client_id)
    
    def on_connect(client, userdata, flags, rc, properties):
        if rc == 0:
            print("Connected to MQTT Broker!")
        else:
            print(f"Failed to connect, return code {rc}")
            
    client.on_connect = on_connect
    client.connect(host, port)
    return client

def publish_simulation(client, machine_id, duration_seconds=60):
    topic = f"huawei/ativação/{machine_id}"
    print(f"Starting telemetry simulation on topic: {topic}")
    
    time_remaining = duration_seconds
    energy = 0.0
    
    interval = 0.1 # 100ms
    steps = int(duration_seconds / interval)
    
    for i in range(steps):
        if not client.is_connected():
            print("Client disconnected, stopping simulation.")
            break
            
        time_remaining = round(duration_seconds - (i * interval), 1)
        
        # Simulate realistic variation in physical activity
        cadence = random.randint(80, 95)
        # Energy generated is proportional to cadence
        energy_increment = (cadence / 60.0) * interval * random.uniform(1.8, 2.2)
        energy = round(energy + energy_increment, 1)
        
        payload = {
            "ativação": machine_id,
            "cadencia": cadence,
            "energia_acumulada": energy,
            "tempo_restante": time_remaining
        }
        
        msg = json.dumps(payload)
        client.publish(topic, msg)
        print(f"Pub -> {topic}: {msg}")
        
        time.sleep(interval)
        
    # Send final payload showing 0 seconds remaining
    final_payload = {
        "ativação": machine_id,
        "cadencia": 0,
        "energia_acumulada": energy,
        "tempo_restante": 0
    }
    client.publish(topic, json.dumps(final_payload))
    print(f"Simulation completed! Final Score: {energy}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="ESP32 Telemetry Emulator (MQTT)")
    parser.add_argument('--host', default='localhost', help='MQTT broker host')
    parser.add_argument('--port', type=int, default=1883, help='MQTT broker port')
    parser.add_argument('--machine', default='bike_01', help='Machine identifier (e.g. bike_01, fast_feet_01)')
    parser.add_argument('--duration', type=int, default=15, help='Simulation duration in seconds')
    
    args = parser.parse_args()
    
    client = connect_mqtt(args.host, args.port)
    client.loop_start()
    time.sleep(1) # Allow connection to establish
    
    try:
        publish_simulation(client, args.machine, args.duration)
    except KeyboardInterrupt:
        print("\nSimulation aborted by user.")
    finally:
        client.loop_stop()
        client.disconnect()
        print("Disconnected.")
