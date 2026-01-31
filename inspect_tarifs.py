import pandas as pd
file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    # First sheet is usually Tarifs
    df = pd.read_excel(file_path, sheet_name=0, header=None, nrows=20)
    print("--- Tarifs Sheet (First 20 rows) ---")
    print(df.to_string())
except Exception as e:
    print(e)
