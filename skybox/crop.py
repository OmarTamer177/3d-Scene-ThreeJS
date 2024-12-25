from PIL import Image

def crop_skybox(image_path, output_dir):
    try:
        # Open the image
        img = Image.open(image_path)
        
        # Check if the image dimensions are compatible
        width, height = img.size
        if width % 1024 != 0 or height % 1024 != 0:
            print("Image dimensions must be a multiple of 1024x1024!")
            return
        
        # Define the number of rows and columns
        rows = height // 1024
        cols = width // 1024
        
        # Ensure it's a standard 6-face skybox
        if rows * cols != 12:
            print("The image does not represent a 6-face skybox!")
            return
        
        # Crop each 1024x1024 region
        for row in range(rows):
            for col in range(cols):
                left = col * 1024
                upper = row * 1024
                right = left + 1024
                lower = upper + 1024
                cropped = img.crop((left, upper, right, lower))
                
                # Save the cropped image
                output_path = f"{output_dir}/skybox_face_{row * cols + col + 1}.png"
                cropped.save(output_path)
                print(f"Cropped and saved: {output_path}")
        
        print("Skybox cropping complete!")
    except Exception as e:
        print(f"Error: {e}")

# Example usage:
# Replace 'skybox.jpg' with your image path, and 'output_directory' with your desired output folder
crop_skybox("skybox_full.png", "./")
