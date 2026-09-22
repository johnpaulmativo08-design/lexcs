
async function registerUser(email, password) {
  try {
    const userCredential = await window.authFunctions.createUserWithEmailAndPassword(
      window.auth, 
      email, 
      password
    );
    alert("Account created successfully!");
  } catch (error) {
    alert("Sign up failed: " + error.message);
  }
}
async function loginUser(email, password) {
  try {
    const userCredential = await window.authFunctions.signInWithEmailAndPassword(
      window.auth, 
      email, 
      password
    );
    window.location.href = "index.html"; // Redirect to homepage
  } catch (error) {
    alert("Login failed: " + error.message);
  }
}
// Run on page load to check if a user is active
window.authFunctions.onAuthStateChanged(window.auth, (user) => {
  if (user) {
    console.log("Logged in as:", user.email);
  } else {
    console.log("No user signed in.");
  }
});
import { initializeApp } from 'firebase/app';

// TODO: Replace the following with your app's Firebase configuration
const firebaseConfig = {
  //...
};

const app = initializeApp(firebaseConfig);

const buttons = document.querySelectorAll(".faq-btn");

buttons.forEach(btn => {

btn.addEventListener("click", () => {

const content = btn.nextElementSibling;

if(content.style.display === "block"){
content.style.display = "none";
}else{
content.style.display = "block";
}


});



});