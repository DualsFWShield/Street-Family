import pandas as pd
file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    xl = pd.ExcelFile(file_path)
    print("Sheet names:", xl.sheet_names)
    for sheet in xl.sheet_names:
        print(f"\n--- Sheet: {sheet} (First 5 rows) ---")
        df = pd.read_excel(file_path, sheet_name=sheet, nrows=5, header=None)
        print(df.to_string())
except Exception as e:
    print(e)
