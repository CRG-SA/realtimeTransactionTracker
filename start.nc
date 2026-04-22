#!/bin/sh

PID="$1"

cat <<EOF | nc -u -w1 10.227.188.40 28000
{
    "Status": "START",
    "Uxd": "22/04/2026",
    "Uxt": "14:08:00.784",
    "Dbd": "",
    "Eid": "sts",
    "Hnm": "cdol-fms-dcb1.telkom.co.za",
    "Pid": "$PID",
    "Fid": "_log_QueryTaskDependencies",
    "Tid": "<unknown>/1698",
    "Fnm": "stsadminimpl_new.cc",
    "Mtp": "TrnStart",
    "Key": "",
    "Uid": "swartzjm",
    "Cid": "",
    "Icn": "10.248.11.41",
    "Ocn": "",
    "Ret": "0",
    "Ern": "0",
    "Ct1": "",
    "Ct2": "221183808:-3200",
    "Msg": "QueryTaskDependencies transaction started for swartzjm"
}
EOF
