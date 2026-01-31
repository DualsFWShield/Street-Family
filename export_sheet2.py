import pandas as pd
file_path = r"c:\Users\Toyger\OneDrive\Projects51c\Street-Family\SF Inscriptions 19-20-21-22-23-24.xlsx"
try:
    xl = pd.ExcelFile(file_path)
    if len(xl.sheet_names) > 1:
        sheet_name = xl.sheet_names[1] # Get second sheet
        print(f"Exporting sheet: {sheet_name}")
        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, nrows=20)
        df.to_csv("sheet2_sample.csv", index=False)
    else:
        print("Only one sheet found.")
except Exception as e:
    print(e)
