"""Experiment 4: adaptive working window (small fixed context + old material recoverable on demand).
Sweep of window size and of the 'recovery' penalty (share of hidden tokens that the model fetches back)."""
from levers import *
full = {"mask", "think", "args", "cap", "index"}
print("combinazione completa (mask+think+args+cap+index); righe = soglia T / blocco minimo / eta' K; colonne = penale di recupero RE")
print(f"{'T / MINFREE / K':22}" + "".join(f"{'RE='+str(r):>9}" for r in (0.1, 0.3, 0.5, 0.8)))
for T, MF, K in ((60000, 20000, 12), (40000, 15000, 12), (30000, 10000, 8), (20000, 8000, 6), (15000, 5000, 4), (10000, 4000, 3)):
    row = []
    for RE in (0.1, 0.3, 0.5, 0.8):
        r, _ = run(full, T=T, MINFREE=MF, K=K, RE=RE); row.append(r)
    print(f"{T:6}/{MF:6}/{K:3}      " + "".join(f"{x*100:8.1f}%" for x in row))
