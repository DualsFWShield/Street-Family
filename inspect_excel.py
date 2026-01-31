import pandas as pd
import sys

file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    # Attempt to read the first sheet
    df = pd.read_excel(file_path, nrows=5)
    print("Columns:", df.columns.tolist())
    print("\nFirst 3 rows:")
    print(df.head(3).to_string())
    print("\nData Types:")
    print(df.dtypes)
except ImportError:
    print("Error: pandas or openpyxl not installed.")
except Exception as e:
    print(f"Error reading excel: {e}")
