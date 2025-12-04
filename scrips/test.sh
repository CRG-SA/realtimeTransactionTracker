echo '{"Status":"START","Uxd":"27/10/2025","Uxt":"07:42:22.000","Eid":"UNIClientApp","Hnm":"pc123","Fid":"LoadCustomerData","Tid":"abc6124"}' | nc -u -w0 127.0.0.1 20000
echo '{"Status":"SUCCESS","Uxd":"27/10/2025","Uxt":"07:42:22.000","Eid":"UNIClientApp","Hnm":"pc123","Fid":"LoadCustomerData","Tid":"abc6124"}' | nc -u -w0 127.0.0.1 20000

echo '{"Status":"START","Uxd":"27/10/2025","Uxt":"07:42:22.000","Eid":"UNIClientApp","Hnm":"pc123","Fid":"LoadCustomerData","Tid":"abc123"}' | nc -u -w0 127.0.0.1 20000
sleep 1
echo '{"Status":"INFO","Uxd":"27/10/2025","Uxt":"07:42:22.000","Eid":"UNIClientApp","Hnm":"pc123","Fid":"LoadCustomerData","Tid":"abc123"}' | nc -u -w0 127.0.0.1 20000
sleep 2
echo '{"Status":"SUCCESS","Uxd":"27/10/2025","Uxt":"07:42:22.000","Eid":"UNIClientApp","Hnm":"pc123","Fid":"LoadCustomerData","Tid":"abc123"}' | nc -u -w0 127.0.0.1 20000
