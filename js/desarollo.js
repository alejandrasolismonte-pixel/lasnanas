console.log("Las Ñañas - sitio desarrollo activo");


const botones = document.querySelectorAll(".btn");


botones.forEach(boton => {


    boton.addEventListener("click",()=>{

        alert("Gracias por visitar Las Ñañas 🌱");

    });


});