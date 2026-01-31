import pandas as pd
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 1000)

file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    # Read without header to see layout
    df = pd.read_excel(file_path, header=None, nrows=10)
    print("--- First 10 rows raw ---")
    print(df.to_string())
except Exception as e:
    print(e)
