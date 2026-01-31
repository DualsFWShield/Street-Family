import pandas as pd
file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    df = pd.read_excel(file_path, header=None, nrows=20)
    df.to_csv("sample_data.csv", index=False)
    print("Exported sample_data.csv")
except Exception as e:
    print(e)
